const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID: uuid } = require("crypto");
const store = require("./store");
const { stampEnvelope, createSampleContract } = require("./pdf");
const { requestEmail, completedEmail, reminderEmail, declinedEmail } = require("./mail");
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
const UPLOADS = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".pdf";
      cb(null, `${uuid()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json({ limit: "12mb" }));

function addAudit(envelope, actor, action) {
  envelope.audit = envelope.audit || [];
  envelope.audit.push({
    id: uuid(),
    at: new Date().toISOString(),
    actor,
    action,
  });
}

function publicEnvelope(env, { includeTokens = false, viewerEmail = "" } = {}) {
  const viewer = String(viewerEmail || "").toLowerCase();
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
    message: env.message,
    declineReason: env.declineReason || "",
    lastRemindedAt: env.lastRemindedAt || null,
    signers: env.signers.map((s) => {
      const showToken = includeTokens || s.email.toLowerCase() === viewer;
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        status: s.status,
        order: s.order,
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
  if (header.startsWith("Bearer ")) return header.slice(7);
  return req.query.access || "";
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

function optionalAuth(req, _res, next) {
  const session = store.getSession(readToken(req));
  if (session) req.user = store.getUser(session.userId) || null;
  next();
}

function canView(env, user) {
  if (!user) return false;
  if (env.ownerId === user.id) return true;
  return env.signers.some((s) => s.email.toLowerCase() === user.email);
}

function appOrigin(req) {
  const fromBody = req.body && req.body.origin;
  if (fromBody) return String(fromBody).replace(/\/$/, "");
  const header = req.headers.origin || req.headers.referer;
  if (header) {
    try { return new URL(header).origin; } catch {}
  }
  return "http://localhost:5173";
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

async function notifySend(req, env) {
  const origin = appOrigin(req);
  const messages = env.signers.map((signer) =>
    requestEmail({
      senderName: req.user.name,
      senderEmail: req.user.email,
      signer,
      envelope: env,
      origin,
    })
  );
  store.addMail(messages);
  let results = [];
  try {
    results = await smtp.sendRequestEmails(activeSmtp(), {
      senderName: req.user.name,
      senderEmail: req.user.email,
      envelope: env,
      origin,
    });
  } catch (err) {
    results = [{ email: "smtp", sent: false, error: err.message }];
  }
  addAudit(
    env,
    "DocySign",
    smtpAuditLine(results, `Emailed signing request to ${env.signers.map((s) => s.email).join(", ")}`)
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
  if (owner && owner.email && !seen.has(owner.email.toLowerCase())) {
    recipients.push({ name: owner.name, email: owner.email });
  }
  return { owner, recipients };
}

async function notifyRemind(req, env, signers) {
  const origin = appOrigin(req);
  const targets = signers.filter((s) => s.status === "pending");
  if (!targets.length) return [];
  store.addMail(targets.map((signer) =>
    reminderEmail({
      senderName: req.user.name,
      senderEmail: req.user.email,
      signer,
      envelope: env,
      origin,
    })
  ));
  let results = [];
  try {
    results = await smtp.sendReminderEmails(activeSmtp(), {
      senderName: req.user.name,
      senderEmail: req.user.email,
      envelope: env,
      origin,
      signers: targets,
    });
  } catch (err) {
    results = [{ email: "smtp", sent: false, error: err.message }];
  }
  addAudit(
    env,
    "DocySign",
    smtpAuditLine(results, `Sent a reminder to ${targets.map((s) => s.email).join(", ")}`)
  );
  return results;
}

async function notifyDeclined(req, env, signer, reason) {
  const origin = appOrigin(req);
  const { owner, recipients } = envelopeParties(env);
  store.addMail(recipients.map((recipient) =>
    declinedEmail({ recipient, envelope: env, signer, reason, origin })
  ));
  let results = [];
  try {
    results = await smtp.sendDeclinedEmails(activeSmtp(), {
      envelope: env,
      origin,
      signer,
      reason,
      owner,
    });
  } catch (err) {
    results = [{ email: "smtp", sent: false, error: err.message }];
  }
  addAudit(
    env,
    "DocySign",
    smtpAuditLine(results, `Emailed decline notice to ${recipients.map((r) => r.email).join(", ")}`)
  );
}

async function notifyCompleted(req, env) {
  const origin = appOrigin(req);
  const owner = store.getUser(env.ownerId);
  const recipients = [];
  const seen = new Set();
  for (const s of env.signers) {
    const key = s.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: s.name, email: s.email });
  }
  if (owner && owner.email && !seen.has(owner.email.toLowerCase())) {
    recipients.push({ name: owner.name, email: owner.email });
  }
  store.addMail(recipients.map((recipient) => completedEmail({ recipient, envelope: env, origin })));
  const pdfPath = env.signedFile ? path.join(UPLOADS, env.signedFile) : null;
  let results = [];
  try {
    results = await smtp.sendCompletedEmails(activeSmtp(), {
      envelope: env,
      origin,
      pdfPath,
      owner,
    });
  } catch (err) {
    results = [{ email: "smtp", sent: false, error: err.message }];
  }
  addAudit(
    env,
    "DocySign",
    smtpAuditLine(results, `Emailed the completed PDF to ${recipients.map((r) => r.email).join(", ")}`)
  );
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/signup", (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    if (name.length < 2) return res.status(400).json({ error: "Enter your full name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email" });
    }
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
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
  const user = store.verifyUser(email, password);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });
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
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/envelopes", auth, (req, res) => {
  const mine = store.listEnvelopes().filter((e) => e.ownerId === req.user.id);
  res.json(mine.map((e) => publicEnvelope(e, { includeTokens: true, viewerEmail: req.user.email })));
});

app.get("/api/inbox", auth, (req, res) => {
  const email = req.user.email;
  const items = store.listEnvelopes().filter((e) =>
    e.status !== "draft" &&
    e.signers.some((s) => s.email.toLowerCase() === email)
  );
  res.json(items.map((e) => publicEnvelope(e, { viewerEmail: email })));
});

app.get("/api/library", auth, (req, res) => {
  const email = req.user.email;
  const items = store.listEnvelopes().filter((e) => {
    if (e.status !== "completed") return false;
    return e.ownerId === req.user.id || e.signers.some((s) => s.email.toLowerCase() === email);
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
    e.ownerId === req.user.id || e.signers.some((s) => s.email.toLowerCase() === email)
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

app.post("/api/settings/smtp/test", auth, requireAdmin, async (req, res) => {
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
});

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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (!canView(env, req.user)) return res.status(403).json({ error: "Not allowed" });
  res.json(publicEnvelope(env, {
    includeTokens: env.ownerId === req.user.id,
    viewerEmail: req.user.email,
  }));
});

function sendPdf(res, filePath) {
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });
  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(filePath);
}

app.get("/api/envelopes/:id/file", optionalAuth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (req.user && !canView(env, req.user) && !req.query.access) {
    return res.status(403).json({ error: "Not allowed" });
  }
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

app.get("/api/envelopes/:id/download", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (!canView(env, req.user)) return res.status(403).json({ error: "Not allowed" });
  const fileName = env.status === "completed" && env.signedFile ? env.signedFile : env.file;
  const filePath = path.join(UPLOADS, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });
  const downloadName = (env.title || "document").replace(/[^\w.-]+/g, "_") +
    (env.status === "completed" ? "_signed.pdf" : ".pdf");
  res.download(filePath, downloadName);
});

function newEnvelope(req, { title, file, fileName, message }) {
  const envelope = {
    id: uuid(),
    ownerId: req.user.id,
    title,
    file,
    fileName,
    status: "draft",
    message: message || "",
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

app.post("/api/envelopes/sample", auth, async (req, res) => {
  try {
    const bytes = await createSampleContract();
    const filename = `${uuid()}.pdf`;
    fs.writeFileSync(path.join(UPLOADS, filename), bytes);
    const envelope = newEnvelope(req, {
      title: "Mutual Non-Disclosure Agreement",
      file: filename,
      fileName: "mutual-nda.pdf",
      message: "Please review the NDA and sign in the fields assigned to you.",
    });
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/envelopes", auth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "PDF file is required" });
  const title = (req.body.title || req.file.originalname.replace(/\.pdf$/i, "")).trim();
  const envelope = newEnvelope(req, {
    title,
    file: req.file.filename,
    fileName: req.file.originalname,
  });
  addAudit(envelope, req.user.name, "Created envelope and uploaded document");
  store.saveEnvelope(envelope);
  res.status(201).json(publicEnvelope(envelope, { includeTokens: true, viewerEmail: req.user.email }));
});

app.put("/api/envelopes/:id", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  if (env.status !== "draft") {
    return res.status(400).json({ error: "Only draft envelopes can be edited" });
  }
  const { title, message, signers, fields } = req.body;
  if (typeof title === "string") env.title = title.trim() || env.title;
  if (typeof message === "string") env.message = message;
  if (Array.isArray(signers)) {
    env.signers = signers.map((s, i) => ({
      id: s.id || uuid(),
      name: String(s.name || "").trim(),
      email: String(s.email || "").trim().toLowerCase(),
      role: s.role === "approver" ? "approver" : "signer",
      order: Number.isFinite(s.order) ? s.order : i + 1,
      status: "pending",
      token: s.token || uuid(),
      signedAt: null,
    }));
  }
  if (Array.isArray(fields)) {
    env.fields = fields.map((f) => ({
      id: f.id || uuid(),
      type: ["signature", "initials", "name", "date", "text"].includes(f.type)
        ? f.type
        : "signature",
      signerId: f.signerId,
      page: f.page || 1,
      x: Number(f.x) || 0,
      y: Number(f.y) || 0,
      w: Number(f.w) || 22,
      h: Number(f.h) || 8,
      required: f.required !== false,
      value: "",
    }));
  }
  addAudit(env, req.user.name, "Updated recipients and fields");
  store.saveEnvelope(env);
  res.json(publicEnvelope(env, { includeTokens: true, viewerEmail: req.user.email }));
});

app.post("/api/envelopes/:id/send", auth, async (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  if (env.status !== "draft") return res.status(400).json({ error: "Already sent" });
  if (!env.signers.length) return res.status(400).json({ error: "Add at least one signer" });
  if (env.signers.some((s) => !s.name || !s.email)) {
    return res.status(400).json({ error: "Every signer needs a name and email" });
  }
  if (!env.fields.length) return res.status(400).json({ error: "Place at least one field" });
  env.status = "sent";
  env.sentAt = new Date().toISOString();
  addAudit(env, req.user.name, `Sent for signature to ${env.signers.map((s) => s.name).join(", ")}`);
  await notifySend(req, env);
  store.saveEnvelope(env);
  res.json(publicEnvelope(env, { includeTokens: true, viewerEmail: req.user.email }));
});

app.delete("/api/envelopes/:id", auth, (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  store.deleteEnvelope(env.id);
  res.json({ ok: true });
});

app.get("/api/sign/:token", (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found) return res.status(404).json({ error: "Signing link is invalid" });
  const { envelope, signer } = found;
  if (envelope.status === "draft") {
    return res.status(400).json({ error: "This envelope has not been sent yet" });
  }
  res.json({
    envelopeId: envelope.id,
    title: envelope.title,
    message: envelope.message,
    status: envelope.status,
    fileName: envelope.fileName,
    hasAccount: !!store.getUserByEmail(signer.email),
    declineReason: envelope.declineReason || "",
    signer: {
      id: signer.id,
      name: signer.name,
      email: signer.email,
      role: signer.role,
      status: signer.status,
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

app.get("/api/sign/:token/file", (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found) return res.status(404).json({ error: "Signing link is invalid" });
  sendPdf(res, path.join(UPLOADS, found.envelope.file));
});

app.get("/api/sign/:token/download", (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found) return res.status(404).json({ error: "Signing link is invalid" });
  const env = found.envelope;
  const fileName = env.status === "completed" && env.signedFile ? env.signedFile : env.file;
  const filePath = path.join(UPLOADS, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });
  const downloadName = (env.title || "document").replace(/[^\w.-]+/g, "_") +
    (env.status === "completed" ? "_signed.pdf" : ".pdf");
  res.download(filePath, downloadName);
});

app.post("/api/envelopes/:id/remind", auth, async (req, res) => {
  const env = store.getEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "Envelope not found" });
  if (env.ownerId !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  if (env.status !== "sent") return res.status(400).json({ error: "Reminders are only for envelopes still waiting on signatures" });
  const signerId = req.body.signerId ? String(req.body.signerId) : "";
  const pending = env.signers.filter((s) => s.status === "pending" && (!signerId || s.id === signerId));
  if (!pending.length) return res.status(400).json({ error: "No pending recipients to remind" });
  const now = new Date().toISOString();
  env.lastRemindedAt = now;
  pending.forEach((s) => { s.lastRemindedAt = now; });
  addAudit(env, req.user.name, `Sent a reminder to ${pending.map((s) => s.name || s.email).join(", ")}`);
  await notifyRemind(req, env, pending);
  store.saveEnvelope(env);
  res.json(publicEnvelope(env, { includeTokens: true, viewerEmail: req.user.email }));
});

app.post("/api/sign/:token/decline", async (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found) return res.status(404).json({ error: "Signing link is invalid" });
  const { envelope, signer } = found;
  if (envelope.status === "completed") {
    return res.status(400).json({ error: "Document is already completed" });
  }
  if (envelope.status === "declined") {
    return res.status(400).json({ error: "This envelope was already declined" });
  }
  if (envelope.status !== "sent") {
    return res.status(400).json({ error: "This envelope cannot be declined" });
  }
  if (signer.status === "signed") {
    return res.status(400).json({ error: "You already signed this document" });
  }
  if (signer.status === "declined") {
    return res.status(400).json({ error: "You already declined this document" });
  }
  const reason = String(req.body.reason || "").trim().slice(0, 500);
  const now = new Date().toISOString();
  signer.status = "declined";
  signer.declinedAt = now;
  envelope.status = "declined";
  envelope.declinedAt = now;
  envelope.declineReason = reason;
  addAudit(
    envelope,
    signer.name,
    reason ? `Declined to sign. Reason: ${reason}` : "Declined to sign"
  );
  await notifyDeclined(req, envelope, signer, reason);
  store.saveEnvelope(envelope);
  res.json({ ok: true, declined: true, status: envelope.status });
});

app.post("/api/sign/:token", async (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found) return res.status(404).json({ error: "Signing link is invalid" });
  const { envelope, signer } = found;
  if (envelope.status === "completed") {
    return res.status(400).json({ error: "Document is already completed" });
  }
  if (envelope.status === "declined") {
    return res.status(400).json({ error: "This envelope was declined and is closed" });
  }
  if (envelope.status !== "sent") {
    return res.status(400).json({ error: "Document is not awaiting signatures" });
  }
  if (signer.status === "signed") {
    return res.status(400).json({ error: "You already signed this document" });
  }
  if (signer.status === "declined") {
    return res.status(400).json({ error: "You declined this document" });
  }

  const values = req.body.values || {};
  const myFields = envelope.fields.filter((f) => f.signerId === signer.id);
  for (const field of myFields) {
    if (field.required && !values[field.id]) {
      return res.status(400).json({ error: `Missing required field: ${field.type}` });
    }
    if (values[field.id]) field.value = values[field.id];
  }

  signer.status = "signed";
  signer.signedAt = new Date().toISOString();
  addAudit(
    envelope,
    signer.name,
    signer.role === "approver" ? "Approved the document" : "Signed the document"
  );

  const allDone = envelope.signers.every((s) => s.status === "signed");
  if (allDone) {
    envelope.status = "completed";
    envelope.completedAt = new Date().toISOString();
    envelope.signedFile = `${envelope.id}-signed.pdf`;
    addAudit(envelope, "DocySign", "All parties signed. Certificate of completion attached.");
    const original = path.join(UPLOADS, envelope.file);
    const output = path.join(UPLOADS, envelope.signedFile);
    try {
      await stampEnvelope(envelope, original, output);
      await notifyCompleted(req, envelope);
    } catch (err) {
      envelope.status = "sent";
      envelope.completedAt = null;
      envelope.signedFile = null;
      signer.status = "pending";
      signer.signedAt = null;
      store.saveEnvelope(envelope);
      return res.status(500).json({ error: "Failed to stamp PDF: " + err.message });
    }
  }

  store.saveEnvelope(envelope);
  res.json({
    ok: true,
    completed: allDone,
    signerStatus: signer.status,
  });
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Request failed" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DocySign API listening on ${PORT}`);
});
