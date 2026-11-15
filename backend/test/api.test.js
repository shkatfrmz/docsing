// End-to-end tests for the API. Run with `npm test` from backend/.
// Each run uses a throwaway data and uploads directory.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docysign-test-"));
process.env.DOCYSIGN_DATA_DIR = path.join(tmp, "data");
process.env.DOCYSIGN_UPLOADS_DIR = path.join(tmp, "uploads");
delete process.env.APP_URL;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;

const { PDFDocument } = require("pdf-lib");
const { app } = require("../server");
const { createSampleContract } = require("../pdf");

const DB = path.join(process.env.DOCYSIGN_DATA_DIR, "db.json");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAFCAYAAAB8ZH1oAAAAFklEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC";

let server;
let base;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(method, url, { token, body, headers } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, type };
}

let counter = 0;
async function newUser(name = "Test User") {
  counter += 1;
  const email = `user${counter}@example.com`;
  const res = await call("POST", "/api/auth/signup", { body: { name, email, password: "secret1" } });
  assert.equal(res.status, 201);
  return { token: res.data.token, email, name, id: res.data.user.id, role: res.data.user.role };
}

// A sent-ready draft: the owner plus one more signer, each with one field.
async function draft(owner, other, extra = {}) {
  const created = await call("POST", "/api/envelopes/sample", { token: owner.token });
  assert.equal(created.status, 201);
  const [first] = created.data.signers;
  const signers = [
    { id: first.id, name: owner.name, email: owner.email, role: "signer" },
    { id: "second", name: other.name, email: other.email, role: "signer" },
  ];
  const fields = [
    { id: "f1", type: "signature", signerId: first.id, page: 1, x: 8, y: 72, w: 24, h: 8 },
    { id: "f2", type: "name", signerId: "second", page: 1, x: 52, y: 72, w: 24, h: 6 },
  ];
  const saved = await call("PUT", `/api/envelopes/${created.data.id}`, {
    token: owner.token,
    body: { signers, fields, ...extra },
  });
  assert.equal(saved.status, 200);
  return saved.data;
}

async function send(owner, id, headers) {
  return call("POST", `/api/envelopes/${id}/send`, { token: owner.token, body: {}, headers });
}

test("the first account is the admin, later ones are not", async () => {
  const a = await newUser("Alice Admin");
  const b = await newUser("Bob Builder");
  assert.equal(a.role, "admin");
  assert.equal(b.role, "user");
  const denied = await call("GET", "/api/admin/users", { token: b.token });
  assert.equal(denied.status, 403);
});

test("documents are only served to people on the envelope", async () => {
  const owner = await newUser("Owner One");
  const signer = await newUser("Signer One");
  const stranger = await newUser("Stranger");
  const env = await draft(owner, signer);

  const anonymous = await call("GET", `/api/envelopes/${env.id}/file`);
  assert.equal(anonymous.status, 401);
  const viaQuery = await call("GET", `/api/envelopes/${env.id}/file?access=${owner.token}`);
  assert.equal(viaQuery.status, 401, "session tokens are not accepted in the URL");
  for (const route of ["file", "original", "download"]) {
    const res = await call("GET", `/api/envelopes/${env.id}/${route}`, { token: stranger.token });
    assert.equal(res.status, 403, route);
  }
  const mine = await call("GET", `/api/envelopes/${env.id}/file`, { token: owner.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.subarray(0, 5).toString(), "%PDF-");
  const theirs = await call("GET", `/api/envelopes/${env.id}/file`, { token: signer.token });
  assert.equal(theirs.status, 200);
});

test("uploads must be real, unprotected PDFs", async () => {
  const owner = await newUser("Uploader");
  async function upload(bytes, name) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
    const res = await fetch(`${base}/api/envelopes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}` },
      body: form,
    });
    return { status: res.status, data: await res.json() };
  }
  const fake = await upload(Buffer.from("this is not a pdf"), "fake.pdf");
  assert.equal(fake.status, 400);
  assert.match(fake.data.error, /not a PDF/);

  const good = await upload(await createSampleContract(), "عقد.pdf");
  assert.equal(good.status, 201);
  assert.equal(good.data.fileName, "عقد.pdf");
  assert.equal(good.data.title, "عقد");
  assert.equal(fs.readdirSync(process.env.DOCYSIGN_UPLOADS_DIR).filter((f) => f.endsWith(".pdf")).length > 0, true);
});

test("drafts cannot choose signing links, and stray fields are dropped", async () => {
  const owner = await newUser("Owner Two");
  const created = await call("POST", "/api/envelopes/sample", { token: owner.token });
  const [first] = created.data.signers;
  const saved = await call("PUT", `/api/envelopes/${created.data.id}`, {
    token: owner.token,
    body: {
      signers: [
        { id: first.id, name: owner.name, email: owner.email, token: "chosen-by-client" },
        { id: "new", name: "New Person", email: "NEW@Example.com", token: "also-chosen" },
      ],
      fields: [
        { id: "ok", type: "text", signerId: "new", page: 99, x: 95, y: -5, w: 30, h: 6 },
        { id: "orphan", type: "text", signerId: "nobody", page: 1, x: 1, y: 1 },
      ],
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.signers[0].token, first.token, "existing link is kept");
  assert.notEqual(saved.data.signers[1].token, "also-chosen");
  assert.equal(saved.data.signers[1].email, "new@example.com");
  assert.equal(saved.data.fields.length, 1);
  const [field] = saved.data.fields;
  assert.equal(field.page, 1, "page is limited to the document");
  assert.equal(field.x, 70, "field is kept inside the page");
  assert.equal(field.y, 0);
});

test("sending checks recipients and fields", async () => {
  const owner = await newUser("Owner Three");
  const other = await newUser("Other Three");
  const env = await draft(owner, other);
  const id = env.id;
  const [first] = env.signers;

  async function trySend(body) {
    const saved = await call("PUT", `/api/envelopes/${id}`, { token: owner.token, body });
    assert.equal(saved.status, 200);
    return send(owner, id);
  }
  const me = { id: first.id, name: owner.name, email: owner.email };
  const myField = { id: "f1", type: "signature", signerId: first.id, page: 1, x: 8, y: 72 };

  let res = await trySend({ signers: [me, { id: "b", name: "Twin", email: owner.email }], fields: [myField] });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /more than once/);

  res = await trySend({ signers: [me, { id: "b", name: "Bad", email: "not-an-email" }], fields: [myField] });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /not a valid email/);

  res = await trySend({ signers: [me, { id: "b", name: "Idle", email: other.email }], fields: [myField] });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /nothing to sign/);

  res = await trySend({ signers: [me, { id: "b", name: "Approver", email: other.email, role: "approver" }], fields: [myField] });
  assert.equal(res.status, 200, "approvers do not need a field");
  assert.equal(res.data.status, "sent");
});

test("email links use the sender's address, never one supplied by a signer", async () => {
  const owner = await newUser("Owner Four");
  const other = await newUser("Other Four");
  const env = await draft(owner, other, { signingOrder: true });
  const sent = await call("POST", `/api/envelopes/${env.id}/send`, {
    token: owner.token,
    body: { origin: "https://evil.example" },
    headers: { Origin: "https://docs.example.com" },
  });
  assert.equal(sent.status, 200);
  const ownerMail = await call("GET", "/api/mail", { token: owner.token });
  assert.match(ownerMail.data[0].link, /^https:\/\/docs\.example\.com\/sign\//);

  // The first signer signs while claiming to come from somewhere else.
  const firstToken = sent.data.signers[0].token;
  const signed = await call("POST", `/api/sign/${firstToken}`, {
    body: { values: { f1: PNG }, origin: "https://evil.example" },
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(signed.status, 200);
  const otherMail = await call("GET", "/api/mail", { token: other.token });
  assert.equal(otherMail.data.length, 1);
  assert.match(otherMail.data[0].link, /^https:\/\/docs\.example\.com\/sign\//);
});

test("signing in order, through to a completed PDF with a certificate", async () => {
  const owner = await newUser("Owner Five");
  const other = await newUser("محمد بن عبدالله");
  const env = await draft(owner, other, { signingOrder: true, title: "عقد عمل — Employment" });
  const sent = await send(owner, env.id);
  assert.equal(sent.status, 200);
  const [first, second] = sent.data.signers;
  assert.equal(second.status, "waiting");

  const early = await call("POST", `/api/sign/${second.token}`, { body: { values: { f2: "x" } } });
  assert.equal(early.status, 400);
  assert.match(early.data.error, /turn/);

  const missing = await call("POST", `/api/sign/${first.token}`, { body: { values: {} } });
  assert.equal(missing.status, 400);
  const junk = await call("POST", `/api/sign/${first.token}`, { body: { values: { f1: "not an image" } } });
  assert.equal(junk.status, 400);
  const object = await call("POST", `/api/sign/${first.token}`, { body: { values: { f1: { a: 1 } } } });
  assert.equal(object.status, 400);

  const one = await call("POST", `/api/sign/${first.token}`, { body: { values: { f1: PNG } } });
  assert.equal(one.status, 200);
  assert.equal(one.data.completed, false);
  const again = await call("POST", `/api/sign/${first.token}`, { body: { values: { f1: PNG } } });
  assert.equal(again.status, 400);

  const two = await call("POST", `/api/sign/${second.token}`, { body: { values: { f2: other.name } } });
  assert.equal(two.status, 200, JSON.stringify(two.data));
  assert.equal(two.data.completed, true);

  const final = await call("GET", `/api/sign/${second.token}/download`);
  assert.equal(final.status, 200);
  const pdf = await PDFDocument.load(final.data);
  assert.equal(pdf.getPageCount(), 2, "original page plus the certificate");

  const view = await call("GET", `/api/envelopes/${env.id}`, { token: owner.token });
  assert.equal(view.data.status, "completed");
  const actions = view.data.audit.map((a) => a.action).join("\n");
  assert.match(actions, /Signed the document \(IP /);
  assert.match(actions, /Emailed the completed PDF/);
  const library = await call("GET", "/api/library", { token: other.token });
  assert.equal(library.data.length, 1);
});

test("declining closes the envelope", async () => {
  const owner = await newUser("Owner Six");
  const other = await newUser("Other Six");
  const env = await draft(owner, other);
  const sent = await send(owner, env.id);
  const token = sent.data.signers[1].token;
  const declined = await call("POST", `/api/sign/${token}/decline`, { body: { reason: "Wrong terms" } });
  assert.equal(declined.status, 200);
  const after = await call("POST", `/api/sign/${sent.data.signers[0].token}`, { body: { values: { f1: PNG } } });
  assert.equal(after.status, 400);
  const view = await call("GET", `/api/envelopes/${env.id}`, { token: owner.token });
  assert.equal(view.data.status, "declined");
  assert.equal(view.data.declineReason, "Wrong terms");
});

test("an envelope out for signature must be voided before it can be deleted", async () => {
  const owner = await newUser("Owner Seven");
  const other = await newUser("Other Seven");
  const env = await draft(owner, other);
  await send(owner, env.id);
  const blocked = await call("DELETE", `/api/envelopes/${env.id}`, { token: owner.token });
  assert.equal(blocked.status, 400);
  const notOwner = await call("POST", `/api/envelopes/${env.id}/void`, { token: other.token, body: {} });
  assert.equal(notOwner.status, 403);
  const voided = await call("POST", `/api/envelopes/${env.id}/void`, { token: owner.token, body: { reason: "Typo" } });
  assert.equal(voided.status, 200);
  assert.equal(voided.data.status, "voided");
  const before = fs.readdirSync(process.env.DOCYSIGN_UPLOADS_DIR).length;
  const deleted = await call("DELETE", `/api/envelopes/${env.id}`, { token: owner.token });
  assert.equal(deleted.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fs.readdirSync(process.env.DOCYSIGN_UPLOADS_DIR).length, before - 1, "the PDF is removed too");
});

test("an expiry date lasts through the end of that day, and a past date cannot be sent", async () => {
  const owner = await newUser("Owner Eight");
  const other = await newUser("Other Eight");
  const env = await draft(owner, other, { expiresAt: "2099-01-31" });
  assert.equal(env.expiresAt, "2099-01-31T23:59:59.999Z");
  const past = await call("PUT", `/api/envelopes/${env.id}`, { token: owner.token, body: { expiresAt: "2001-01-01" } });
  assert.equal(past.status, 200);
  const res = await send(owner, env.id);
  assert.equal(res.status, 400);
  assert.match(res.data.error, /already passed/);
});

test("changing a password signs out other devices", async () => {
  const user = await newUser("Password Person");
  const second = await call("POST", "/api/auth/login", { body: { email: user.email, password: "secret1" } });
  assert.equal(second.status, 200);
  const changed = await call("POST", "/api/auth/password", {
    token: user.token,
    body: { currentPassword: "secret1", password: "secret2" },
  });
  assert.equal(changed.status, 200);
  assert.equal((await call("GET", "/api/auth/me", { token: user.token })).status, 200);
  assert.equal((await call("GET", "/api/auth/me", { token: second.data.token })).status, 401);
});

test("repeated failed logins are slowed down", async () => {
  const user = await newUser("Guessed Person");
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call("POST", "/api/auth/login", { body: { email: user.email, password: "wrong" } });
  }
  assert.equal(last.status, 429);
  const right = await call("POST", "/api/auth/login", { body: { email: user.email, password: "secret1" } });
  assert.equal(right.status, 429, "the block also covers the right password until it lifts");
});

test("a damaged data file is reported, not replaced with an empty one", async () => {
  const good = fs.readFileSync(DB, "utf8");
  try {
    fs.writeFileSync(DB, "{ this is not json");
    const res = await call("POST", "/api/auth/signup", {
      body: { name: "Late Comer", email: "late@example.com", password: "secret1" },
    });
    assert.equal(res.status, 500);
    assert.match(res.data.error, /could not be read/);
    assert.equal(fs.readFileSync(DB, "utf8"), "{ this is not json", "the file is left alone");
  } finally {
    fs.writeFileSync(DB, good);
  }
  assert.equal((await call("GET", "/api/health")).status, 200);
});
