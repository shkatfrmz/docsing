const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "db.json");

function empty() {
  return { users: [], sessions: [], envelopes: [], mail: [] };
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(empty(), null, 2));
  }
}

function read() {
  ensureDir();
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    data.users = data.users || [];
    data.sessions = data.sessions || [];
    data.envelopes = data.envelopes || [];
    data.mail = data.mail || [];
    return data;
  } catch {
    return empty();
  }
}

function write(data) {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function getUser(id) {
  return read().users.find((u) => u.id === id) || null;
}

function getUserByEmail(email) {
  const key = String(email || "").trim().toLowerCase();
  return read().users.find((u) => u.email === key) || null;
}

function createUser({ name, email, password }) {
  const data = read();
  const key = String(email || "").trim().toLowerCase();
  if (data.users.some((u) => u.email === key)) {
    const err = new Error("An account with this email already exists");
    err.status = 400;
    throw err;
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: crypto.randomUUID(),
    name: String(name || "").trim(),
    email: key,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  write(data);
  return user;
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

function createSession(userId) {
  const data = read();
  const session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: new Date().toISOString(),
  };
  data.sessions.push(session);
  write(data);
  return session;
}

function getSession(token) {
  if (!token) return null;
  return read().sessions.find((s) => s.token === token) || null;
}

function deleteSession(token) {
  const data = read();
  data.sessions = data.sessions.filter((s) => s.token !== token);
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

module.exports = {
  publicUser,
  getUser,
  getUserByEmail,
  createUser,
  verifyUser,
  createSession,
  getSession,
  deleteSession,
  listEnvelopes,
  getEnvelope,
  getByToken,
  saveEnvelope,
  deleteEnvelope,
  addMail,
  listMail,
  getMail,
  markMailRead,
};
