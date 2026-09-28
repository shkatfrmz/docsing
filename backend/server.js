const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID: uuid } = require("crypto");
const store = require("./store");
const { stampEnvelope, createSampleContract } = require("./pdf");
const { requestEmail, completedEmail } = require("./mail");

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
    sentAt: env.sentAt,
    message: env.message,
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

function notifySend(req, env) {
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
  addAudit(env, "DocySign", `Emailed signing request to ${env.signers.map((s) => s.email).join(", ")}`);
}

function notifyCompleted(req, env) {
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
  if (owner && !seen.has(owner.email)) {
    recipients.push({ name: owner.name, email: owner.email });
  }
  store.addMail(recipients.map((recipient) => completedEmail({ recipient, envelope: env, origin })));
  addAudit(env, "DocySign", `Emailed the completed PDF to ${recipients.map((r) => r.email).join(", ")}`);
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

app.post("/api/envelopes/:id/send", auth, (req, res) => {
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
  notifySend(req, env);
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

app.post("/api/sign/:token", async (req, res) => {
  const found = store.getByToken(req.params.token);
  if (!found) return res.status(404).json({ error: "Signing link is invalid" });
  const { envelope, signer } = found;
  if (envelope.status === "completed") {
    return res.status(400).json({ error: "Document is already completed" });
  }
  if (envelope.status !== "sent") {
    return res.status(400).json({ error: "Document is not awaiting signatures" });
  }
  if (signer.status === "signed") {
    return res.status(400).json({ error: "You already signed this document" });
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
      notifyCompleted(req, envelope);
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
