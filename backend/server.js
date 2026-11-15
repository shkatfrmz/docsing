const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID: uuid } = require("crypto");
const store = require("./store");
const { stampEnvelope, createSampleContract, inspectPdf } = require("./pdf");
const { requestEmail, completedEmail, reminderEmail, declinedEmail, voidedEmail, ccEmail } = require("./mail");
const smtp = require("./smtp");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile();

const app = express();
const PORT = process.env.PORT || 3001;
const UPLOADS = process.env.DOCYSIGN_UPLOADS_DIR || path.join(__dirname, "uploads");
const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");
// Public address of the app, used for links in emails. When unset, the
// address the sender was using when they sent the envelope is used instead.
const APP_URL = cleanOrigin(process.env.APP_URL);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

// Browsers send multipart filenames as UTF-8 but they are decoded as latin1,
// which garbles non-English names. Undo that when it round-trips cleanly.
function decodeFileName(name) {
  const raw = String(name || "document.pdf");
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  const fixed = utf8.includes("\uFFFD") ? raw : utf8;
  return path.basename(fixed.replace(/\\/g, "/")).slice(0, 200) || "document.pdf";
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, _file, cb) => cb(null, `${uuid()}.pdf`),
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(httpError(400, "Only PDF files are allowed"));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

// Trust X-Forwarded-For only from a proxy on this machine (the Vite dev
// server or a local reverse proxy), so audit entries record the real client.
app.set("trust proxy", process.env.TRUST_PROXY || "loopback");
app.disable("x-powered-by");
app.use(cors());
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use(express.json({ limit: "12mb" }));

// Express 4 does not catch rejected promises from async handlers.
function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function removeUpload(name) {
  if (!name) return;
  const target = path.join(UPLOADS, path.basename(name));
  fs.rm(target, { force: true }, () => {});
}

function addAudit(envelope, actor, action) {
  envelope.audit = envelope.audit || [];
  envelope.audit.push({
    id: uuid(),
    at: new Date().toISOString(),
    actor,
    action,
  });
}

function currentSigner(env) {
  if (!env.signingOrder) return null;
  const ordered = [...env.signers].sort((a, b) => (a.order || 0) - (b.order || 0));
  return ordered.find((s) => s.status === "pending") || null;
}

function expireIfNeeded(env) {
  if (!env || env.status !== "sent" || !env.expiresAt) return env;
  if (new Date(env.expiresAt).getTime() > Date.now()) return env;
  env.status = "expired";
  env.expiredAt = new Date().toISOString();
  addAudit(env, "DocySign", `Envelope expired on ${new Date(env.expiresAt).toLocaleDateString()}`);
  store.saveEnvelope(env);
  return env;
}

function publicEnvelope(env, { includeTokens = false, viewerEmail = "" } = {}) {
  const viewer = String(viewerEmail || "").toLowerCase();
  const turn = currentSigner(env);
  return {
    id: env.id,
    ownerId: env.ownerId,
    title: env.title,
    status: env.status,
    fileName: env.fileName,
    createdAt: env.createdAt,
    updatedAt: env.updatedAt,
    completedAt: env.completedAt,
    declinedAt: env.declinedAt,
    sentAt: env.sentAt,
    voidedAt: env.voidedAt || null,
    expiredAt: env.expiredAt || null,
    expiresAt: env.expiresAt || null,
    message: env.message,
    declineReason: env.declineReason || "",
    voidReason: env.voidReason || "",
    lastRemindedAt: env.lastRemindedAt || null,
    signingOrder: !!env.signingOrder,
    currentSignerId: turn ? turn.id : null,
    cc: (env.cc || []).map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
    })),
    signers: env.signers.map((s) => {
      const showToken = includeTokens || s.email.toLowerCase() === viewer;
      const waitingOnPrior = !!(env.signingOrder && turn && s.id !== turn.id && s.status === "pending");
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        status: waitingOnPrior ? "waiting" : s.status,
        order: s.order,
        viewedAt: s.viewedAt || null,
        signedAt: s.signedAt,
        declinedAt: s.declinedAt,
        lastRemindedAt: s.lastRemindedAt,
        token: showToken ? s.token : undefined,
      };
    }),
    fields: env.fields,
    audit: env.audit,
  };
}

function readToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function auth(req, res, next) {
  const session = store.getSession(readToken(req));
  if (!session) return res.status(401).json({ error: "Please log in" });
  const user = store.getUser(session.userId);
  if (!user) return res.status(401).json({ error: "Please log in" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!store.isAdmin(req.user)) return res.status(403).json({ error: "Admin only" });
  next();
}

function canView(env, user) {
  if (!user) return false;
  if (env.ownerId === user.id) return true;
  const email = user.email.toLowerCase();
  if (env.signers.some((s) => s.email.toLowerCase() === email)) return true;
  return (env.cc || []).some((c) => String(c.email || "").toLowerCase() === email);
}

// Where the person making this request is using the app from.
function requestOrigin(req) {
  return (
    APP_URL ||
    cleanOrigin(req.headers.origin) ||
    cleanOrigin(req.headers.referer) ||
    cleanOrigin(`${req.protocol}://${req.get("host")}`) ||
    "http://localhost:5173"
  );
}

// Links in emails about an envelope always point at the address its sender
// used. Signing requests are unauthenticated, so the address must never come
// from the person signing.
function appOrigin(req, env) {
  return APP_URL || (env && cleanOrigin(env.origin)) || requestOrigin(req);
}

function activeSmtp() {
  const saved = store.getSmtp();
  if (smtp.isConfigured(saved)) return saved;
  return smtp.envSettings() || saved;
}

function smtpAuditLine(results, fallback) {
  if (!results || !results.length) return fallback;
  if (results.every((r) => r.skipped)) {
    return `${fallback} SMTP is not configured — save Gmail or Postfix settings to send real email.`;
  }
  const sent = results.filter((r) => r.sent).map((r) => r.email);
  const failed = results.filter((r) => !r.sent && !r.skipped);
  if (failed.length) {
    return `SMTP sent to ${sent.join(", ") || "nobody"}. Failed: ${failed.map((f) => `${f.email} (${f.error})`).join("; ")}`;
  }
  return fallback;
}

function recipientsToNotify(env) {
  if (!env.signingOrder) return env.signers.filter((s) => s.status === "pending");
  const next = currentSigner(env);
  return next ? [next] : [];
}

// Sending mail can take seconds, and someone may sign in the meantime. The
// caller saves the envelope first; the outcome is then recorded on the latest
// copy so nothing saved in between is overwritten.
function recordNotice(env, line) {
  const fresh = store.getEnvelope(env.id);
  if (!fresh) return env;
  addAudit(fresh, "DocySign", line);
  return store.saveEnvelope(fresh);
}

async function deliver(env, line, send) {
  let results = [];
  try {
    results = await send(activeSmtp());
  } catch (err) {
    results = [{ email: "smtp", sent: false, error: err.message }];
  }
  return recordNotice(env, smtpAuditLine(results, line));
}

function senderOf(req, env) {
  const owner = store.getUser(env.ownerId);
  return {
    senderName: (req.user && req.user.name) || (owner && owner.name) || "DocySign",
    senderEmail: (req.user && req.user.email) || (owner && owner.email) || "docs@docysign.app",
  };
}

async function notifySend(req, env, signers) {
  const origin = appOrigin(req, env);
  const targets = signers && signers.length ? signers : recipientsToNotify(env);
  if (!targets.length) return env;
  const { senderName, senderEmail } = senderOf(req, env);
  store.addMail(targets.map((signer) =>
    requestEmail({ senderName, senderEmail, signer, envelope: env, origin })
  ));
  return deliver(
    env,
    `Emailed signing request to ${targets.map((s) => s.email).join(", ")}`,
    (settings) => smtp.sendRequestEmails(settings, { senderName, senderEmail, envelope: env, origin, signers: targets })
  );
}

async function notifyCc(req, env) {
  const origin = appOrigin(req, env);
  const copies = env.cc || [];
  if (!copies.length) return env;
  store.addMail(copies.map((recipient) => ccEmail({ recipient, envelope: env, origin })));
  return deliver(
    env,
    `Copied ${copies.map((c) => c.email).join(", ")} on this envelope`,
    (settings) => smtp.sendCcEmails(settings, { envelope: env, origin, copies })
  );
}

function envelopeParties(env) {
  const owner = store.getUser(env.ownerId);
  const recipients = [];
  const seen = new Set();
  for (const s of env.signers) {
    const key = s.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: s.name, email: s.email });
  }
  for (const c of env.cc || []) {
    const key = String(c.email || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: c.name, email: c.email });
  }
  if (owner && owner.email && !seen.has(owner.email.toLowerCase())) {
    recipients.push({ name: owner.name, email: owner.email });
  }
  return { owner, recipients };
}

function normalizeCc(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const c of list.slice(0, 50)) {
    const email = String((c && c.email) || "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!EMAIL_RE.test(email)) continue;
    seen.add(email);
    out.push({
      id: safeId(c.id),
      name: String(c.name || "").trim().slice(0, 200) || email,
      email,
    });
  }
  return out;
}

async function notifyRemind(req, env, signers) {
  const origin = appOrigin(req, env);
  const targets = signers.filter((s) => s.status === "pending");
  if (!targets.length) return env;
  const { senderName, senderEmail } = senderOf(req, env);
  store.addMail(targets.map((signer) =>
    reminderEmail({ senderName, senderEmail, signer, envelope: env, origin })
  ));
  return deliver(
    env,
    `Sent a reminder to ${targets.map((s) => s.email).join(", ")}`,
    (settings) => smtp.sendReminderEmails(settings, { senderName, senderEmail, envelope: env, origin, signers: targets })
  );
}

async function notifyDeclined(req, env, signer, reason) {
  const origin = appOrigin(req, env);
  const { owner, recipients } = envelopeParties(env);
  store.addMail(recipients.map((recipient) =>
    declinedEmail({ recipient, envelope: env, signer, reason, origin })
  ));
  return deliver(
    env,
    `Emailed decline notice to ${recipients.map((r) => r.email).join(", ")}`,
    (settings) => smtp.sendDeclinedEmails(settings, { envelope: env, origin, signer, reason, owner })
  );
}

async function notifyVoided(req, env, reason) {
  const origin = appOrigin(req, env);
  const { owner, recipients } = envelopeParties(env);
  store.addMail(recipients.map((recipient) =>
    voidedEmail({ recipient, envelope: env, reason, origin, actorName: req.user.name })
  ));
  return deliver(
    env,
    `Emailed void notice to ${recipients.map((r) => r.email).join(", ")}`,
    (settings) => smtp.sendVoidedEmails(settings, { envelope: env, origin, reason, owner, actorName: req.user.name })
  );
}

async function notifyCompleted(req, env) {
  const origin = appOrigin(req, env);
  const { owner, recipients } = envelopeParties(env);
  store.addMail(recipients.map((recipient) => completedEmail({ recipient, envelope: env, origin })));
  const pdfPath = env.signedFile ? path.join(UPLOADS, env.signedFile) : null;
  return deliver(
    env,
    `Emailed the completed PDF to ${recipients.map((r) => r.email).join(", ")}`,
    (settings) => smtp.sendCompletedEmails(settings, { envelope: env, origin, pdfPath, owner })
  );
}

// Ids arrive from the browser while a draft is edited. Keep short plain ones
// so fields stay linked to their recipient, and replace anything else.
function safeId(value) {
  return typeof value === "string" && /^[\w-]{1,64}$/.test(value) ? value : uuid();
}

// Failed logins per address and email, to slow down password guessing.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map();

function loginKey(req, email) {
  return `${req.ip}|${String(email).toLowerCase()}`;
}

function loginBlocked(key) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function noteLoginFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { first: Date.now(), count: 1 });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > 5000) {
    for (const [k, v] of loginFailures) {
      if (Date.now() - v.first > LOGIN_WINDOW_MS) loginFailures.delete(k);
    }
  }
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/signup", (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 200) return res.status(400).json({ error: "Enter your full name" });
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Enter a valid email" });
    }
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    if (password.length > 1000) return res.status(400).json({ error: "Password is too long" });
    const user = store.createUser({ name, email, password });
    const session = store.createSession(user.id);
    res.status(201).json({ token: session.token, user: store.publicUser(user) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  const key = loginKey(req, email);
  if (loginBlocked(key)) {
    return res.status(429).json({ error: "Too many failed attempts. Wait 15 minutes and try again." });
  }
  const user = store.verifyUser(email, password);
  if (!user) {
    noteLoginFailure(key);
    return res.status(401).json({ error: "Invalid email or password" });
  }
  loginFailures.delete(key);
  const session = store.createSession(user.id);
  res.json({ token: session.token, user: store.publicUser(user) });
});

app.post("/api/auth/logout", auth, (req, res) => {
  store.deleteSession(readToken(req));
  res.json({ ok: true });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json(store.publicUser(req.user));
});

app.post("/api/auth/password", auth, (req, res) => {
  try {
    const current = String(req.body.currentPassword || "");
    const next = String(req.body.password || "");
    if (!current) return res.status(400).json({ error: "Enter your current password" });
    store.changePassword(req.user.id, current, next);
    // Sign out every other device; keep the one that made the change.
    store.deleteUserSessions(req.user.id, readToken(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.patch("/api/auth/profile", auth, (req, res) => {
  try {
    const user = store.updateProfile(req.user.id, {
      name: req.body.name,
      signature: req.body.signature,
      initials: req.body.initials,
    });
    res.json(store.publicUser(user));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/auth/signature", auth, (req, res) => {
  res.json(store.getSignature(req.user.id));
});

app.get("/api/contacts", auth, (req, res) => {
  res.json(store.listContacts(req.user.id));
});

app.post("/api/contacts", auth, (req, res) => {
  try {
    const contact = store.createContact(req.user.id, {
      name: req.body.name,
      email: req.body.email,
      company: req.body.company,
    });
    res.status(201).json(contact);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete("/api/contacts/:id", auth, (req, res) => {
  const ok = store.deleteContact(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: "Contact not found" });
  res.json({ ok: true });
});

app.get("/api/templates", auth, (req, res) => {
  res.json(store.listTemplates(req.user.id).map((t) => ({
    id: t.id,
    title: t.title,
    fileName: t.fileName,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    signerCount: (t.signers || []).length,
    fieldCount: (t.fields || []).length,
  })));
});

app.delete("/api/templates/:id", auth, (req, res) => {
  const removed = store.deleteTemplate(req.user.id, req.params.id);
  if (!removed) return res.status(404).json({ error: "Template not found" });
  removeUpload(removed.file);
  res.json({ ok: true });
});

app.get("/api/envelopes", auth, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const mine = store.listEnvelopes()
    .map(expireIfNeeded)
    .filter((e) => e.ownerId === req.user.id)
    .filter((e) => {
      if (!q) return true;
      return e.title.toLowerCase().includes(q)
        || e.fileName.toLowerCase().includes(q)
        || e.signers.some((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
    });
  res.json(mine.map((e) => publicEnvelope(e, { includeTokens: true, viewerEmail: req.user.email })));
});

app.get("/api/inbox", auth, (req, res) => {
  const email = req.user.email;
  const items = store.listEnvelopes()
    .map(expireIfNeeded)
    .filter((e) =>
      e.status !== "draft" &&
      e.signers.some((s) => s.email.toLowerCase() === email)
    );
  res.json(items.map((e) => publicEnvelope(e, { viewerEmail: email })));
});

app.get("/api/library", auth, (req, res) => {
  const email = req.user.email;
  const items = store.listEnvelopes().filter((e) => {
    if (e.status !== "completed") return false;
    return e.ownerId === req.user.id
      || e.signers.some((s) => s.email.toLowerCase() === email)
      || (e.cc || []).some((c) => String(c.email || "").toLowerCase() === email);
  });
  res.json(items.map((e) => publicEnvelope(e, {
    includeTokens: e.ownerId === req.user.id,
    viewerEmail: email,
  })));
});

app.get("/api/stats", auth, (req, res) => {
  const email = req.user.email;
  const all = store.listEnvelopes();
  const related = all.filter((e) =>
    e.ownerId === req.user.id
    || e.signers.some((s) => s.email.toLowerCase() === email)
    || (e.cc || []).some((c) => String(c.email || "").toLowerCase() === email)
  );
  const signedByMe = all.filter((e) =>
    e.signers.some((s) => s.email.toLowerCase() === email && s.status === "signed")
  );
  res.json({
    signedCount: signedByMe.length,
    pendingCount: related.filter((e) =>
      e.status === "sent" && e.signers.some((s) => s.email.toLowerCase() === email && s.status === "pending")
    ).length,
    completedCount: related.filter((e) => e.status === "completed").length,
    sentCount: all.filter((e) => e.ownerId === req.user.id).length,
  });
});

app.get("/api/settings/smtp", auth, requireAdmin, (_req, res) => {
  res.json(smtp.publicSettings(activeSmtp()));
});

app.put("/api/settings/smtp", auth, requireAdmin, (req, res) => {
  const saved = store.saveSmtp({
    host: req.body.host,
    port: req.body.port,
    secure: req.body.secure,
    user: req.body.user,
    pass: req.body.pass,
    fromName: req.body.fromName,
    fromEmail: req.body.fromEmail,
  });
  res.json(smtp.publicSettings(saved));
});

app.post("/api/settings/smtp/test", auth, requireAdmin, wrap(async (req, res) => {
  const settings = activeSmtp();
  if (!smtp.isConfigured(settings)) {
    return res.status(400).json({ error: "Save SMTP settings first" });
  }
  const to = String(req.body.to || req.user.email || "").trim();
  if (!to) return res.status(400).json({ error: "Enter an address to test" });
  try {
    await smtp.sendTestEmail(settings, to);
    res.json({ ok: true, to });
  } catch (err) {
    res.status(400).json({ error: err.message || "SMTP test failed" });
  }
}));

app.get("/api/admin/stats", auth, requireAdmin, (_req, res) => {
  const users = store.listUsers();
  const envelopes = store.listEnvelopes();
  const signatures = envelopes.reduce(
    (n, e) => n + e.signers.filter((s) => s.status === "signed").length,
    0
  );
  res.json({
    users: users.length,
    admins: users.filter((u) => u.role === "admin").length,
    envelopes: envelopes.length,
    drafts: envelopes.filter((e) => e.status === "draft").length,
    sent: envelopes.filter((e) => e.status === "sent").length,
    completed: envelopes.filter((e) => e.status === "completed").length,
    declined: envelopes.filter((e) => e.status === "declined").length,
    voided: envelopes.filter((e) => e.status === "voided").length,
    expired: envelopes.filter((e) => e.status === "expired").length,
    pdfsSigned: signatures,
    pdfsDelivered: envelopes.filter((e) => e.status === "completed").length,
    waiting: envelopes.filter((e) => e.status === "sent").length,
    mailSent: store.listMailAll().length,
    smtpReady: smtp.isConfigured(activeSmtp()),
  });
});

app.get("/api/admin/users", auth, requireAdmin, (_req, res) => {
  res.json(store.listUsers());
});

app.post("/api/admin/users", auth, requireAdmin, (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    const role = req.body.role === "admin" ? "admin" : "user";
    if (name.length < 2) return res.status(400).json({ error: "Enter a full name" });
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email" });
    }
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const user = store.createUser({ name, email, password, role });
    res.status(201).json(store.publicUser(user));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.patch("/api/admin/users/:id", auth, requireAdmin, (req, res) => {
  try {
    const user = store.setUserRole(req.params.id, req.body.role);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(store.publicUser(user));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete("/api/admin/users/:id", auth, requireAdmin, (req, res) => {
  try {
    const ok = store.deleteUser(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/admin/users/:id/password", auth, requireAdmin, (req, res) => {
  try {
    const user = store.setPassword(req.params.id, req.body.password);
    if (!user) return res.status(404).json({ error: "User not found" });
    store.deleteUserSessions(user.id, user.id === req.user.id ? readToken(req) : null);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/admin/envelopes", auth, requireAdmin, (_req, res) => {
  const items = store.listEnvelopes().map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    ownerId: e.ownerId,
    fileName: e.fileName,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    completedAt: e.completedAt,
    sentAt: e.sentAt,
    signers: e.signers.map((s) => ({
      name: s.name,
      email: s.email,
      status: s.status,
      role: s.role,
    })),
  }));
  res.json(items);
});

app.get("/api/mail", auth, (req, res) => {
  res.json(store.listMail(req.user.email));
});

app.get("/api/mail/:id", auth, (req, res) => {
  const msg = store.getMail(req.params.id);
  if (!msg || msg.to !== req.user.email) return res.status(404).json({ error: "Message not found" });
  store.markMailRead(msg.id);
  res.json({ ...msg, read: true });
});

app.post("/api/mail/:id/read", auth, (req, res) => {
  const msg = store.getMail(req.params.id);
  if (!msg || msg.to !== req.user.email) return res.status(404).json({ error: "Message not found" });
  store.markMailRead(msg.id);
  res.json({ ok: true });
});

app.get("/api/envelopes/:id", auth, (req, res) => {
  let env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  env = expireIfNeeded(env);
  if (!canView(env, req.user)) return res.status(403).json({ error: "Not allowed" });
  res.json(publicEnvelope(env, {
    includeTokens: env.ownerId === req.user.id,
    viewerEmail: req.user.email,
  }));
});

function sendPdf(res, filePath) {
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(filePath);
}

app.get("/api/envelopes/:id/file", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (!canView(env, req.user)) return res.status(403).json({ error: "Not allowed" });
  const filePath = env.status === "completed" && env.signedFile
    ? path.join(UPLOADS, env.signedFile)
    : path.join(UPLOADS, env.file);
  sendPdf(res, filePath);
});

app.get("/api/envelopes/:id/original", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (!canView(env, req.user)) return res.status(403).json({ error: "Not allowed" });
  sendPdf(res, path.join(UPLOADS, env.file));
});

function downloadName(env) {
  const base = String(env.title || "document").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "document";
  return base + (env.status === "completed" && env.signedFile ? "_signed.pdf" : ".pdf");
}

app.get("/api/envelopes/:id/download", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (!canView(env, req.user)) return res.status(403).json({ error: "Not allowed" });
  const fileName = env.status === "completed" && env.signedFile ? env.signedFile : env.file;
  const filePath = path.join(UPLOADS, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });
  res.download(filePath, downloadName(env));
});

function copyPdf(filename) {
  const ext = path.extname(filename) || ".pdf";
  const next = `${uuid()}${ext}`;
  fs.copyFileSync(path.join(UPLOADS, filename), path.join(UPLOADS, next));
  return next;
}

function newEnvelope(req, { title, file, fileName, message }) {
  const envelope = {
    id: uuid(),
    ownerId: req.user.id,
    title,
    file,
    fileName,
    status: "draft",
    message: message || "",
    signingOrder: false,
    expiresAt: null,
    cc: [],
    signers: [{
      id: uuid(),
      name: req.user.name,
      email: req.user.email,
      role: "signer",
      order: 1,
      status: "pending",
      token: uuid(),
      signedAt: null,
    }],
    fields: [],
    audit: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return envelope;
}

app.post("/api/envelopes/sample", auth, wrap(async (req, res) => {
  const bytes = await createSampleContract();
  const filename = `${uuid()}.pdf`;
  fs.writeFileSync(path.join(UPLOADS, filename), bytes);
  const envelope = newEnvelope(req, {
    title: "Mutual Non-Disclosure Agreement",
    file: filename,
    fileName: "mutual-nda.pdf",
    message: "Please review the NDA and sign in the fields assigned to you.",
  });
  envelope.pageCount = 1;
  envelope.signers.push({
    id: uuid(),
    name: "",
    email: "",
    role: "approver",
    order: 2,
    status: "pending",
    token: uuid(),
    signedAt: null,
  });
  addAudit(envelope, req.user.name, "Created envelope from sample NDA");
  store.saveEnvelope(envelope);
  res.status(201).json(publicEnvelope(envelope, { includeTokens: true, viewerEmail: req.user.email }));
}));

app.post("/api/envelopes", auth, upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "PDF file is required" });
  let info;
  try {
    // Reject files that could not be stamped later, before anyone signs them.
    info = await inspectPdf(req.file.path);
  } catch (err) {
    removeUpload(req.file.filename);
    return res.status(400).json({ error: err.message });
  }
  const fileName = decodeFileName(req.file.originalname);
  const title = String(req.body.title || fileName.replace(/\.pdf$/i, "")).trim().slice(0, 200) || "Untitled";
  const envelope = newEnvelope(req, {
    title,
    file: req.file.filename,
    fileName,
  });
  envelope.pageCount = info.pageCount;
  addAudit(envelope, req.user.name, "Created envelope and uploaded document");
  store.saveEnvelope(envelope);
  res.status(201).json(publicEnvelope(envelope, { includeTokens: true, viewerEmail: req.user.email }));
}));

const FIELD_TYPES = ["signature", "initials", "name", "date", "text", "checkbox"];
const MAX_FIELDS = 500;
const MAX_SIGNERS = 50;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Keeps only fields that belong to a recipient on this envelope and sit
// inside the page, so nothing can be stamped off-page or onto a missing page.
function normalizeFields(fields, signers, pageCount) {
  const signerIds = new Set(signers.map((s) => s.id));
  const seen = new Set();
  const maxPage = pageCount > 0 ? pageCount : 10000;
  return fields
    .filter((f) => f && typeof f === "object" && signerIds.has(f.signerId))
    .slice(0, MAX_FIELDS)
    .map((f) => {
      const type = FIELD_TYPES.includes(f.type) ? f.type : "signature";
      const w = clamp(f.w, 1, 100, type === "checkbox" ? 4 : 22);
      const h = clamp(f.h, 1, 100, type === "checkbox" ? 4 : 8);
      let id = safeId(f.id);
      if (seen.has(id)) id = uuid();
      seen.add(id);
      return {
        id,
        type,
        signerId: f.signerId,
        page: Math.round(clamp(f.page, 1, maxPage, 1)),
        x: clamp(f.x, 0, 100 - w, 0),
        y: clamp(f.y, 0, 100 - h, 0),
        w,
        h,
        required: f.required !== false,
        value: "",
      };
    });
}

function normalizeSigners(signers, existing) {
  const known = new Map((existing || []).map((s) => [s.id, s]));
  const seen = new Set();
  return signers
    .filter((s) => s && typeof s === "object")
    .slice(0, MAX_SIGNERS)
    .map((s, i) => {
      let id = safeId(s.id);
      if (seen.has(id)) id = uuid();
      seen.add(id);
      const previous = known.get(id);
      return {
        id,
        name: String(s.name || "").trim().slice(0, 200),
        email: String(s.email || "").trim().toLowerCase().slice(0, 254),
        role: s.role === "approver" ? "approver" : "signer",
        order: Number.isFinite(s.order) ? s.order : i + 1,
        status: "pending",
        // Signing links are secrets: they are only ever generated here.
        token: previous ? previous.token : uuid(),
        signedAt: null,
      };
    });
}

// A date picked in the browser means "through the end of that day".
function parseExpiry(value) {
  const text = String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T23:59:59.999Z`) : new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

app.put("/api/envelopes/:id", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  if (env.status !== "draft") {
    return res.status(400).json({ error: "Only draft envelopes can be edited" });
  }
  const { title, message, signers, fields, signingOrder, expiresAt, cc } = req.body || {};
  if (typeof title === "string") env.title = title.trim().slice(0, 200) || env.title;
  if (typeof message === "string") env.message = message.slice(0, 5000);
  if (typeof signingOrder === "boolean") env.signingOrder = signingOrder;
  if (expiresAt === null || expiresAt === "") env.expiresAt = null;
  else if (typeof expiresAt === "string") {
    const d = parseExpiry(expiresAt);
    if (!d) return res.status(400).json({ error: "Invalid expiration date" });
    env.expiresAt = d.toISOString();
  }
  if (cc !== undefined) env.cc = normalizeCc(cc);
  if (Array.isArray(signers)) {
    env.signers = normalizeSigners(signers, env.signers);
    // Fields of removed recipients go with them.
    env.fields = normalizeFields(env.fields || [], env.signers, env.pageCount);
  }
  if (Array.isArray(fields)) env.fields = normalizeFields(fields, env.signers, env.pageCount);
  const last = (env.audit || [])[env.audit.length - 1];
  const action = "Updated recipients and fields";
  if (last && last.actor === req.user.name && last.action === action) last.at = new Date().toISOString();
  else addAudit(env, req.user.name, action);
  store.saveEnvelope(env);
  res.json(publicEnvelope(env, { includeTokens: true, viewerEmail: req.user.email }));
});

function sendProblem(env) {
  if (!env.signers.length) return "Add at least one signer";
  if (env.signers.some((s) => !s.name || !s.email)) return "Every signer needs a name and email";
  const bad = env.signers.find((s) => !EMAIL_RE.test(s.email));
  if (bad) return `${bad.email} is not a valid email address`;
  const emails = env.signers.map((s) => s.email.toLowerCase());
  const repeated = emails.find((e, i) => emails.indexOf(e) !== i);
  if (repeated) return `${repeated} is listed more than once. Each recipient needs their own email address.`;
  if (!env.fields.length) return "Place at least one field";
  const idle = env.signers.find((s) => s.role !== "approver" && !env.fields.some((f) => f.signerId === s.id));
  if (idle) return `${idle.name} has nothing to sign. Place a field for them or change them to an approver.`;
  if (env.expiresAt && new Date(env.expiresAt).getTime() <= Date.now()) {
    return "The expiration date has already passed";
  }
  return "";
}

app.post("/api/envelopes/:id/send", auth, wrap(async (req, res) => {
  let env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  if (env.status !== "draft") return res.status(400).json({ error: "Already sent" });
  const problem = sendProblem(env);
  if (problem) return res.status(400).json({ error: problem });
  env.status = "sent";
  env.sentAt = new Date().toISOString();
  env.origin = requestOrigin(req);
  addAudit(env, req.user.name, `Sent for signature to ${env.signers.map((s) => s.name).join(", ")}`);
  store.saveEnvelope(env);
  env = await notifySend(req, env, recipientsToNotify(env));
  if ((env.cc || []).length) env = await notifyCc(req, env);
  res.json(publicEnvelope(env, { includeTokens: true, viewerEmail: req.user.email }));
}));

app.post("/api/envelopes/:id/void", auth, wrap(async (req, res) => {
  let env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  expireIfNeeded(env);
  if (env.status !== "sent") return res.status(400).json({ error: "Only in-flight envelopes can be voided" });
  const reason = String((req.body && req.body.reason) || "").trim().slice(0, 500);
  env.status = "voided";
  env.voidedAt = new Date().toISOString();
  env.voidReason = reason;
  addAudit(env, req.user.name, reason ? `Voided the envelope. Reason: ${reason}` : "Voided the envelope");
  store.saveEnvelope(env);
  env = await notifyVoided(req, env, reason);
  res.json(publicEnvelope(env, { includeTokens: true, viewerEmail: req.user.email }));
}));

app.post("/api/envelopes/:id/duplicate", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (!canView(env, req.user)) return res.status(403).json({ error: "Not allowed" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Only the sender can duplicate" });
  const copy = {
    id: uuid(),
    ownerId: req.user.id,
    title: `${env.title} (copy)`.slice(0, 200),
    file: copyPdf(env.file),
    fileName: env.fileName,
    pageCount: env.pageCount,
    status: "draft",
    message: env.message || "",
    signingOrder: !!env.signingOrder,
    expiresAt: null,
    cc: (env.cc || []).map((c) => ({ ...c, id: uuid() })),
    signers: env.signers.map((s, i) => ({
      id: uuid(),
      name: s.name,
      email: s.email,
      role: s.role,
      order: s.order || i + 1,
      status: "pending",
      token: uuid(),
      signedAt: null,
    })),
    fields: [],
    audit: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const idMap = {};
  env.signers.forEach((s, i) => { idMap[s.id] = copy.signers[i].id; });
  copy.fields = (env.fields || []).map((f) => ({
    ...f,
    id: uuid(),
    signerId: idMap[f.signerId] || copy.signers[0].id,
    value: "",
  }));
  addAudit(copy, req.user.name, `Duplicated from “${env.title}”`);
  store.saveEnvelope(copy);
  res.status(201).json(publicEnvelope(copy, { includeTokens: true, viewerEmail: req.user.email }));
});

app.post("/api/envelopes/:id/template", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  const title = String((req.body && req.body.title) || env.title || "Untitled template").trim().slice(0, 200);
  const template = {
    id: uuid(),
    ownerId: req.user.id,
    title,
    file: copyPdf(env.file),
    fileName: env.fileName,
    pageCount: env.pageCount,
    message: env.message || "",
    signingOrder: !!env.signingOrder,
    cc: (env.cc || []).map((c) => ({ name: c.name, email: c.email })),
    signers: env.signers.map((s, i) => ({
      name: s.name,
      email: s.email,
      role: s.role,
      order: s.order || i + 1,
    })),
    fields: (env.fields || []).map((f) => ({
      type: f.type,
      signerIndex: Math.max(0, env.signers.findIndex((s) => s.id === f.signerId)),
      page: f.page,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      required: f.required !== false,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.saveTemplate(template);
  res.status(201).json({
    id: template.id,
    title: template.title,
    fileName: template.fileName,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    signerCount: template.signers.length,
    fieldCount: template.fields.length,
  });
});

app.post("/api/templates/:id/use", auth, (req, res) => {
  const tpl = store.getTemplate(req.params.id);
  if (!tpl || tpl.ownerId !== req.user.id) return res.status(404).json({ error: "Template not found" });
  const envelope = newEnvelope(req, {
    title: tpl.title,
    file: copyPdf(tpl.file),
    fileName: tpl.fileName,
    message: tpl.message,
  });
  envelope.pageCount = tpl.pageCount;
  envelope.signingOrder = !!tpl.signingOrder;
  envelope.cc = (tpl.cc || []).map((c) => ({ id: uuid(), name: c.name, email: c.email }));
  envelope.signers = (tpl.signers || []).map((s, i) => ({
    id: uuid(),
    name: s.name,
    email: s.email,
    role: s.role === "approver" ? "approver" : "signer",
    order: s.order || i + 1,
    status: "pending",
    token: uuid(),
    signedAt: null,
  }));
  if (!envelope.signers.length) {
    envelope.signers = [{
      id: uuid(),
      name: req.user.name,
      email: req.user.email,
      role: "signer",
      order: 1,
      status: "pending",
      token: uuid(),
      signedAt: null,
    }];
  }
  envelope.fields = normalizeFields(
    (tpl.fields || []).map((f) => ({
      ...f,
      id: uuid(),
      signerId: envelope.signers[Math.min(f.signerIndex || 0, envelope.signers.length - 1)].id,
    })),
    envelope.signers,
    envelope.pageCount
  );
  addAudit(envelope, req.user.name, `Started envelope from template “${tpl.title}”`);
  store.saveEnvelope(envelope);
  res.status(201).json(publicEnvelope(envelope, { includeTokens: true, viewerEmail: req.user.email }));
});

app.delete("/api/envelopes/:id", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  expireIfNeeded(env);
  if (env.status === "sent") {
    // Deleting would leave recipients with dead links and no explanation.
    return res.status(400).json({ error: "This envelope is out for signature. Void it first, then delete it." });
  }
  store.deleteEnvelope(env.id);
  removeUpload(env.file);
  removeUpload(env.signedFile);
  res.json({ ok: true });
});

function clientInfo(req) {
  return {
    ip: String(req.ip || "").replace(/^::ffff:/, "") || "unknown",
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
  };
}

app.get("/api/sign/:token", (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found) return res.status(404).json({ error: "Signing link is invalid" });
  const envelope = expireIfNeeded(found.envelope);
  const signer = found.signer;
  if (envelope.status === "draft") {
    return res.status(400).json({ error: "This envelope has not been sent yet" });
  }
  const turn = currentSigner(envelope);
  const waitingOnPrior = !!(envelope.signingOrder && envelope.status === "sent" && turn && turn.id !== signer.id && signer.status === "pending");
  if (envelope.status === "sent" && signer.status === "pending" && !waitingOnPrior && !signer.viewedAt) {
    signer.viewedAt = new Date().toISOString();
    addAudit(envelope, signer.name, `Opened the document (IP ${clientInfo(req).ip})`);
    store.saveEnvelope(envelope);
  }
  res.json({
    envelopeId: envelope.id,
    title: envelope.title,
    message: envelope.message,
    status: envelope.status,
    fileName: envelope.fileName,
    signingOrder: !!envelope.signingOrder,
    waitingOnPrior,
    currentSigner: turn ? { id: turn.id, name: turn.name } : null,
    expiresAt: envelope.expiresAt || null,
    hasAccount: !!store.getUserByEmail(signer.email),
    declineReason: envelope.declineReason || "",
    voidReason: envelope.voidReason || "",
    signer: {
      id: signer.id,
      name: signer.name,
      email: signer.email,
      role: signer.role,
      status: waitingOnPrior ? "waiting" : signer.status,
      signedAt: signer.signedAt,
    },
    fields: envelope.fields.filter((f) => f.signerId === signer.id),
    allSigners: envelope.signers.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      status: s.status,
      order: s.order,
    })),
  });
});

function signingFile(env) {
  return env.status === "completed" && env.signedFile ? env.signedFile : env.file;
}

app.get("/api/sign/:token/file", (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found || found.envelope.status === "draft") {
    return res.status(404).json({ error: "Signing link is invalid" });
  }
  sendPdf(res, path.join(UPLOADS, signingFile(found.envelope)));
});

app.get("/api/sign/:token/download", (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found || found.envelope.status === "draft") {
    return res.status(404).json({ error: "Signing link is invalid" });
  }
  const env = found.envelope;
  const filePath = path.join(UPLOADS, signingFile(env));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });
  res.download(filePath, downloadName(env));
});

app.post("/api/envelopes/:id/remind", auth, wrap(async (req, res) => {
  let env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  expireIfNeeded(env);
  if (env.status !== "sent") return res.status(400).json({ error: "Reminders are only for envelopes still waiting on signatures" });
  const signerId = req.body && req.body.signerId ? String(req.body.signerId) : "";
  const turn = currentSigner(env);
  const pending = env.signers.filter((s) => {
    if (s.status !== "pending") return false;
    if (signerId && s.id !== signerId) return false;
    if (env.signingOrder && turn && s.id !== turn.id) return false;
    return true;
  });
  if (!pending.length) return res.status(400).json({ error: "No pending recipients to remind" });
  const now = new Date().toISOString();
  env.lastRemindedAt = now;
  pending.forEach((s) => { s.lastRemindedAt = now; });
  addAudit(env, req.user.name, `Sent a reminder to ${pending.map((s) => s.name || s.email).join(", ")}`);
  store.saveEnvelope(env);
  env = await notifyRemind(req, env, pending);
  res.json(publicEnvelope(env, { includeTokens: true, viewerEmail: req.user.email }));
}));

// Why this recipient cannot act on the envelope right now, or "".
function closedReason(envelope, signer) {
  expireIfNeeded(envelope);
  if (envelope.status === "completed") return "Document is already completed";
  if (envelope.status === "declined") return "This envelope was declined and is closed";
  if (envelope.status === "expired") return "This envelope has expired";
  if (envelope.status === "voided") return "This envelope was voided";
  if (envelope.status !== "sent") return "Document is not awaiting signatures";
  if (signer.status === "signed") return "You already signed this document";
  if (signer.status === "declined") return "You declined this document";
  return "";
}

// One signing or declining request per envelope at a time, so a double click
// cannot complete it twice while the PDF is being stamped.
const busyEnvelopes = new Set();

function exclusive(handler) {
  return wrap(async (req, res) => {
    const found = store.getByToken(req.params.token);
    if (!found) return res.status(404).json({ error: "Signing link is invalid" });
    const id = found.envelope.id;
    if (busyEnvelopes.has(id)) {
      return res.status(409).json({ error: "This document is being updated. Try again in a moment." });
    }
    busyEnvelopes.add(id);
    try {
      await handler(req, res, found);
    } finally {
      busyEnvelopes.delete(id);
    }
  });
}

app.post("/api/sign/:token/decline", exclusive(async (req, res, found) => {
  let { envelope } = found;
  const { signer } = found;
  const closed = closedReason(envelope, signer);
  if (closed) return res.status(400).json({ error: closed });
  const reason = String((req.body && req.body.reason) || "").trim().slice(0, 500);
  const now = new Date().toISOString();
  signer.status = "declined";
  signer.declinedAt = now;
  envelope.status = "declined";
  envelope.declinedAt = now;
  envelope.declineReason = reason;
  addAudit(
    envelope,
    signer.name,
    `${reason ? `Declined to sign. Reason: ${reason}` : "Declined to sign"} (IP ${clientInfo(req).ip})`
  );
  store.saveEnvelope(envelope);
  envelope = await notifyDeclined(req, envelope, signer, reason);
  res.json({ ok: true, declined: true, status: envelope.status });
}));

const IMAGE_VALUE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const MAX_IMAGE_VALUE = 2 * 1024 * 1024;
const MAX_TEXT_VALUE = 500;

// Validates one submitted value and returns what to store, or throws.
function fieldValue(field, raw) {
  if (field.type === "checkbox") {
    const on = raw === true || raw === "true" || raw === "Yes";
    if (field.required && !on) throw httpError(400, "A required checkbox is unchecked");
    return on ? "Yes" : "No";
  }
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    if (field.required) throw httpError(400, `Missing required field: ${field.type}`);
    return "";
  }
  if (field.type === "signature" || field.type === "initials") {
    if (value.length > MAX_IMAGE_VALUE || !IMAGE_VALUE.test(value)) {
      throw httpError(400, `The ${field.type} could not be read. Draw or type it again.`);
    }
    return value;
  }
  return value.slice(0, MAX_TEXT_VALUE);
}

app.post("/api/sign/:token", exclusive(async (req, res, found) => {
  let { envelope } = found;
  const { signer } = found;
  const closed = closedReason(envelope, signer);
  if (closed) return res.status(400).json({ error: closed });
  const turn = currentSigner(envelope);
  if (envelope.signingOrder && turn && turn.id !== signer.id) {
    return res.status(400).json({ error: `It is ${turn.name}'s turn to sign first` });
  }

  const submitted = req.body && req.body.values;
  const values = submitted && typeof submitted === "object" && !Array.isArray(submitted) ? submitted : {};
  for (const field of envelope.fields.filter((f) => f.signerId === signer.id)) {
    field.value = fieldValue(field, values[field.id]);
  }

  const client = clientInfo(req);
  signer.status = "signed";
  signer.signedAt = new Date().toISOString();
  signer.signedIp = client.ip;
  signer.signedUserAgent = client.userAgent;
  addAudit(
    envelope,
    signer.name,
    `${signer.role === "approver" ? "Approved the document" : "Signed the document"} (IP ${client.ip})`
  );

  const allDone = envelope.signers.every((s) => s.status === "signed");
  if (allDone) {
    envelope.status = "completed";
    envelope.completedAt = new Date().toISOString();
    envelope.signedFile = `${envelope.id}-signed.pdf`;
    addAudit(envelope, "DocySign", "All parties signed. Certificate of completion attached.");
    try {
      await stampEnvelope(
        envelope,
        path.join(UPLOADS, envelope.file),
        path.join(UPLOADS, envelope.signedFile)
      );
    } catch (err) {
      // Nothing has been saved yet, so the envelope is still waiting on this
      // signer and they can try again.
      console.error(`Could not stamp envelope ${envelope.id}:`, err);
      return res.status(500).json({ error: "The signed PDF could not be created: " + err.message });
    }
  }

  store.saveEnvelope(envelope);
  if (allDone) {
    envelope = await notifyCompleted(req, envelope);
  } else if (envelope.signingOrder) {
    const next = currentSigner(envelope);
    if (next) envelope = await notifySend(req, envelope, [next]);
  }

  res.json({
    ok: true,
    completed: allDone,
    signerStatus: "signed",
  });
}));

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// In production the built frontend is served from here too, so one process
// and one port run the whole app.
if (fs.existsSync(path.join(FRONTEND_DIST, "index.html"))) {
  app.use(express.static(FRONTEND_DIST, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  let status = err.status || err.statusCode;
  if (!status) status = err.name === "MulterError" ? 400 : 500;
  let message = err.message || "Request failed";
  if (err.code === "LIMIT_FILE_SIZE") message = "That PDF is larger than 20 MB";
  if (status >= 500) {
    console.error(err);
    // Errors raised on purpose carry a status and a message meant for people.
    if (!err.status) message = "Something went wrong on the server";
  }
  res.status(status).json({ error: message });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DocySign API listening on ${PORT}`);
  });
}

module.exports = { app };
