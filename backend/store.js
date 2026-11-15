const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DOCYSIGN_DATA_DIR || path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "db.json");
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function empty() {
  return { users: [], sessions: [], envelopes: [], mail: [], smtp: null, contacts: [], templates: [] };
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) write(empty(), true);
}

function read() {
  ensureDir();
  let data;
  try {
    data = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch (cause) {
    // Never fall back to an empty store here: the next write would replace
    // every user and envelope on disk with nothing.
    const err = new Error(
      `The data file ${STORE_FILE} could not be read (${cause.message}). ` +
      "Fix or restore it, then try again. Nothing was changed."
    );
    err.status = 500;
    throw err;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const err = new Error(`The data file ${STORE_FILE} does not contain a DocySign database.`);
    err.status = 500;
    throw err;
  }
  data.users = data.users || [];
  data.sessions = data.sessions || [];
  data.envelopes = data.envelopes || [];
  data.mail = data.mail || [];
  data.smtp = data.smtp || null;
  data.contacts = data.contacts || [];
  data.templates = data.templates || [];
  data.auth = data.auth || null;
  let changed = false;
  data.users.forEach((u) => {
    if (!u.role) {
      u.role = "user";
      changed = true;
    }
  });
  if (data.users.length && !data.users.some((u) => u.role === "admin")) {
    data.users[0].role = "admin";
    changed = true;
  }
  if (changed) write(data);
  return data;
}

// Write to a temp file and rename it into place, so a crash mid-write leaves
// the previous database intact instead of a half-written one.
function write(data, skipEnsure) {
  if (!skipEnsure) ensureDir();
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
    createdAt: user.createdAt,
    // "local" accounts have a DocySign password; "ldap" and "entra" accounts
    // sign in through the company directory.
    authSource: user.authSource || "local",
    hasSignature: !!(user.signature && String(user.signature).startsWith("data:image")),
    hasInitials: !!(user.initials && String(user.initials).startsWith("data:image")),
  };
}

function isAdmin(user) {
  return !!(user && user.role === "admin");
}

function listUsers() {
  return read().users.map(publicUser);
}

function getUser(id) {
  return read().users.find((u) => u.id === id) || null;
}

function getUserByEmail(email) {
  const key = String(email || "").trim().toLowerCase();
  return read().users.find((u) => u.email === key) || null;
}

function createUser({ name, email, password, role }) {
  const data = read();
  const key = String(email || "").trim().toLowerCase();
  if (data.users.some((u) => u.email === key)) {
    const err = new Error("An account with this email already exists");
    err.status = 400;
    throw err;
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const firstUser = data.users.length === 0;
  const user = {
    id: crypto.randomUUID(),
    name: String(name || "").trim(),
    email: key,
    salt,
    passwordHash: hashPassword(password, salt),
    role: firstUser || role === "admin" ? "admin" : "user",
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  write(data);
  return user;
}

function countUsers() {
  return read().users.length;
}

/**
 * Finds or creates the account for someone who signed in through the
 * directory. `admin` true/false follows a directory group; undefined leaves
 * the role alone. The last admin is never demoted.
 */
function upsertDirectoryUser({ email, name, source, admin }) {
  const data = read();
  const key = String(email || "").trim().toLowerCase();
  let user = data.users.find((u) => u.email === key);
  if (!user) {
    // A random password nobody knows: this account only signs in through the directory.
    const salt = crypto.randomBytes(16).toString("hex");
    user = {
      id: crypto.randomUUID(),
      name: String(name || key).trim().slice(0, 200),
      email: key,
      salt,
      passwordHash: hashPassword(crypto.randomBytes(32).toString("hex"), salt),
      role: data.users.length === 0 ? "admin" : "user",
      authSource: source,
      createdAt: new Date().toISOString(),
    };
    data.users.push(user);
  } else {
    if (name) user.name = String(name).trim().slice(0, 200);
    if (!user.authSource || user.authSource === "local") user.linkedSource = source;
    else user.authSource = source;
  }
  if (admin === true) user.role = "admin";
  if (admin === false && user.role === "admin") {
    if (data.users.filter((u) => u.role === "admin").length > 1) user.role = "user";
  }
  user.lastLoginAt = new Date().toISOString();
  write(data);
  return user;
}

function getAuthSettings() {
  return read().auth || null;
}

function saveAuthSettings(settings) {
  const data = read();
  data.auth = settings;
  write(data);
  return data.auth;
}

function setUserRole(id, role) {
  const data = read();
  const user = data.users.find((u) => u.id === id);
  if (!user) return null;
  const next = role === "admin" ? "admin" : "user";
  if (user.role === "admin" && next !== "admin") {
    const admins = data.users.filter((u) => u.role === "admin").length;
    if (admins <= 1) {
      const err = new Error("Keep at least one admin");
      err.status = 400;
      throw err;
    }
  }
  user.role = next;
  write(data);
  return user;
}

function deleteUser(id, actorId) {
  const data = read();
  const user = data.users.find((u) => u.id === id);
  if (!user) return null;
  if (user.id === actorId) {
    const err = new Error("You cannot delete your own account");
    err.status = 400;
    throw err;
  }
  if (user.role === "admin") {
    const admins = data.users.filter((u) => u.role === "admin").length;
    if (admins <= 1) {
      const err = new Error("Keep at least one admin");
      err.status = 400;
      throw err;
    }
  }
  data.users = data.users.filter((u) => u.id !== id);
  data.sessions = data.sessions.filter((s) => s.userId !== id);
  write(data);
  return true;
}

function verifyUser(email, password) {
  const user = getUserByEmail(email);
  if (!user) return null;
  const hash = hashPassword(password, user.salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(user.passwordHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return user;
}

function setPassword(id, nextPassword) {
  const password = String(nextPassword || "");
  if (password.length < 6) {
    const err = new Error("Password must be at least 6 characters");
    err.status = 400;
    throw err;
  }
  const data = read();
  const user = data.users.find((u) => u.id === id);
  if (!user) return null;
  user.salt = crypto.randomBytes(16).toString("hex");
  user.passwordHash = hashPassword(password, user.salt);
  write(data);
  return user;
}

function changePassword(id, currentPassword, nextPassword) {
  const user = getUser(id);
  if (!user) return null;
  const check = verifyUser(user.email, currentPassword);
  if (!check) {
    const err = new Error("Current password is wrong");
    err.status = 400;
    throw err;
  }
  return setPassword(id, nextPassword);
}

function updateProfile(id, patch) {
  const data = read();
  const user = data.users.find((u) => u.id === id);
  if (!user) return null;
  if (typeof patch.name === "string") {
    const name = patch.name.trim();
    if (name.length < 2) {
      const err = new Error("Enter your full name");
      err.status = 400;
      throw err;
    }
    user.name = name;
  }
  if (patch.signature !== undefined) {
    const val = String(patch.signature || "");
    if (val && !val.startsWith("data:image")) {
      const err = new Error("Signature must be a drawn image");
      err.status = 400;
      throw err;
    }
    user.signature = val;
  }
  if (patch.initials !== undefined) {
    const val = String(patch.initials || "");
    if (val && !val.startsWith("data:image")) {
      const err = new Error("Initials must be a drawn image");
      err.status = 400;
      throw err;
    }
    user.initials = val;
  }
  write(data);
  return user;
}

function getSignature(id) {
  const user = getUser(id);
  if (!user) return { signature: "", initials: "" };
  return {
    signature: user.signature || "",
    initials: user.initials || "",
  };
}

function sessionExpired(session) {
  const created = new Date(session.createdAt).getTime();
  return !Number.isFinite(created) || Date.now() - created > SESSION_TTL_MS;
}

function createSession(userId) {
  const data = read();
  const session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: new Date().toISOString(),
  };
  data.sessions = data.sessions.filter((s) => !sessionExpired(s));
  data.sessions.push(session);
  write(data);
  return session;
}

function getSession(token) {
  if (!token) return null;
  const session = read().sessions.find((s) => s.token === token);
  if (!session || sessionExpired(session)) return null;
  return session;
}

function deleteSession(token) {
  const data = read();
  data.sessions = data.sessions.filter((s) => s.token !== token);
  write(data);
}

// Signs a user out everywhere, optionally keeping the session they are using.
function deleteUserSessions(userId, keepToken) {
  const data = read();
  data.sessions = data.sessions.filter((s) => s.userId !== userId || s.token === keepToken);
  write(data);
}

function listEnvelopes() {
  return read().envelopes.sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
}

function getEnvelope(id) {
  return read().envelopes.find((e) => e.id === id) || null;
}

function getByToken(token) {
  const data = read();
  for (const env of data.envelopes) {
    const signer = env.signers.find((s) => s.token === token);
    if (signer) return { envelope: env, signer };
  }
  return null;
}

function saveEnvelope(envelope) {
  const data = read();
  const idx = data.envelopes.findIndex((e) => e.id === envelope.id);
  envelope.updatedAt = new Date().toISOString();
  if (idx >= 0) data.envelopes[idx] = envelope;
  else data.envelopes.push(envelope);
  write(data);
  return envelope;
}

function deleteEnvelope(id) {
  const data = read();
  data.envelopes = data.envelopes.filter((e) => e.id !== id);
  write(data);
}

function addMail(messages) {
  const data = read();
  data.mail = data.mail.concat(messages);
  write(data);
}

function listMail(email) {
  const key = String(email || "").toLowerCase();
  return read()
    .mail.filter((m) => m.to === key)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function listMailAll() {
  return read().mail;
}

function getMail(id) {
  return read().mail.find((m) => m.id === id) || null;
}

function markMailRead(id) {
  const data = read();
  const msg = data.mail.find((m) => m.id === id);
  if (msg) msg.read = true;
  write(data);
  return msg || null;
}

function getSmtp() {
  return read().smtp || null;
}

function saveSmtp(settings) {
  const data = read();
  const prev = data.smtp || {};
  const text = (value) => String(value || "").trim();
  // A blank secret means "keep the one already saved".
  const keep = (value, old) => (value === undefined || value === "" ? old || "" : String(value));
  const provider = settings.provider === "graph" ? "graph" : "smtp";
  data.smtp = {
    provider,
    preset: text(settings.preset).slice(0, 40) || "custom",
    host: text(settings.host),
    port: Number(settings.port) || 587,
    secure: !!settings.secure,
    noAuth: !!settings.noAuth,
    allowSelfSigned: !!settings.allowSelfSigned,
    user: text(settings.user),
    pass: keep(settings.pass, prev.pass),
    tenantId: text(settings.tenantId),
    clientId: text(settings.clientId),
    clientSecret: keep(settings.clientSecret, prev.clientSecret),
    fromName: text(settings.fromName || "DocySign") || "DocySign",
    fromEmail: text(settings.fromEmail || (provider === "smtp" ? settings.user : "")),
  };
  write(data);
  return data.smtp;
}

function listContacts(userId) {
  return read()
    .contacts.filter((c) => c.ownerId === userId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createContact(userId, { name, email, company }) {
  const data = read();
  const key = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) {
    const err = new Error("Enter a valid email");
    err.status = 400;
    throw err;
  }
  const existing = data.contacts.find((c) => c.ownerId === userId && c.email === key);
  if (existing) {
    existing.name = String(name || existing.name).trim() || existing.name;
    existing.company = String(company || existing.company || "").trim();
    write(data);
    return existing;
  }
  const contact = {
    id: crypto.randomUUID(),
    ownerId: userId,
    name: String(name || "").trim() || key,
    email: key,
    company: String(company || "").trim(),
    createdAt: new Date().toISOString(),
  };
  data.contacts.push(contact);
  write(data);
  return contact;
}

function deleteContact(userId, id) {
  const data = read();
  const before = data.contacts.length;
  data.contacts = data.contacts.filter((c) => !(c.id === id && c.ownerId === userId));
  if (data.contacts.length === before) return false;
  write(data);
  return true;
}

function listTemplates(userId) {
  return read()
    .templates.filter((t) => t.ownerId === userId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getTemplate(id) {
  return read().templates.find((t) => t.id === id) || null;
}

function saveTemplate(template) {
  const data = read();
  const idx = data.templates.findIndex((t) => t.id === template.id);
  template.updatedAt = new Date().toISOString();
  if (idx >= 0) data.templates[idx] = template;
  else data.templates.push(template);
  write(data);
  return template;
}

function deleteTemplate(userId, id) {
  const data = read();
  const tpl = data.templates.find((t) => t.id === id);
  if (!tpl || tpl.ownerId !== userId) return false;
  data.templates = data.templates.filter((t) => t.id !== id);
  write(data);
  return tpl;
}

module.exports = {
  publicUser,
  isAdmin,
  listUsers,
  getUser,
  getUserByEmail,
  createUser,
  setUserRole,
  deleteUser,
  verifyUser,
  setPassword,
  changePassword,
  updateProfile,
  getSignature,
  createSession,
  getSession,
  deleteSession,
  deleteUserSessions,
  countUsers,
  upsertDirectoryUser,
  getAuthSettings,
  saveAuthSettings,
  listEnvelopes,
  getEnvelope,
  getByToken,
  saveEnvelope,
  deleteEnvelope,
  addMail,
  listMail,
  listMailAll,
  getMail,
  markMailRead,
  getSmtp,
  saveSmtp,
  listContacts,
  createContact,
  deleteContact,
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
};
