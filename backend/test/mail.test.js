// Tests for the ways mail can leave the app: an SMTP server with a sign-in,
// a trusted relay with none (such as an internal IIS SMTP relay), and
// Microsoft 365 through the Graph API. All run against local stand-ins.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { SMTPServer } = require("smtp-server");

const smtp = require("../smtp");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docysign-mail-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function fakeSmtp({ requireAuth }) {
  const received = [];
  const logins = [];
  const server = new SMTPServer({
    disabledCommands: ["STARTTLS"],
    authOptional: !requireAuth,
    authMethods: ["LOGIN"],
    onAuth(auth, _session, cb) {
      logins.push(auth.method);
      if (auth.username === "relay-user" && auth.password === "relay-pass") return cb(null, { user: auth.username });
      cb(new Error("Invalid login"));
    },
    onData(stream, session, cb) {
      let raw = "";
      stream.on("data", (d) => { raw += d; });
      stream.on("end", () => {
        received.push({ raw, from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map((r) => r.address), user: session.user });
        cb();
      });
    },
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, received, logins, port: server.server.address().port }));
  });
}

const envelope = { id: "e1", title: "Service Agreement", signers: [{ name: "Khalid", email: "khalid@example.com", token: "tok" }], cc: [] };

test("SMTP with a sign-in delivers the completed PDF as an attachment", async () => {
  const { server, received, logins, port } = await fakeSmtp({ requireAuth: true });
  const pdfPath = path.join(tmp, "signed.pdf");
  fs.writeFileSync(pdfPath, "%PDF-1.7 test");
  const settings = { provider: "smtp", host: "127.0.0.1", port, user: "relay-user", pass: "relay-pass", fromName: "DocySign", fromEmail: "sign@example.com" };
  assert.equal(smtp.isConfigured(settings), true);
  const results = await smtp.sendCompletedEmails(settings, { envelope, origin: "https://sign.example.com", pdfPath, owner: { name: "Sara", email: "sara@example.com" } });
  server.close();
  assert.deepEqual(results.map((r) => r.sent), [true, true]);
  assert.equal(logins[0], "LOGIN", "works with servers that only offer AUTH LOGIN, like Azure Communication Services");
  assert.equal(received.length, 2);
  assert.equal(received[0].from, "sign@example.com");
  assert.deepEqual(received[0].to, ["khalid@example.com"]);
  assert.match(received[0].raw, /Service_Agreement_signed\.pdf/);
  assert.match(received[0].raw, /https:\/\/sign\.example\.com\/sign\/tok/);
});

test("a wrong SMTP password is reported per recipient", async () => {
  const { server, port } = await fakeSmtp({ requireAuth: true });
  const settings = { provider: "smtp", host: "127.0.0.1", port, user: "relay-user", pass: "nope", fromEmail: "sign@example.com" };
  const results = await smtp.sendRequestEmails(settings, { senderName: "Sara", senderEmail: "sara@example.com", envelope, origin: "https://x.example", signers: envelope.signers });
  server.close();
  assert.equal(results[0].sent, false);
  assert.match(results[0].error, /Invalid login/);
});

test("a trusted relay needs no sign-in, only a From address", async () => {
  const { server, received, logins, port } = await fakeSmtp({ requireAuth: false });
  const settings = { provider: "smtp", preset: "local-relay", host: "127.0.0.1", port, noAuth: true, fromName: "DocySign", fromEmail: "docysign@company.example" };
  assert.equal(smtp.isConfigured(settings), true);
  assert.equal(smtp.isConfigured({ ...settings, fromEmail: "" }), false);
  await smtp.sendTestEmail(settings, "admin@company.example");
  server.close();
  assert.equal(logins.length, 0, "no sign-in is attempted");
  assert.equal(received.length, 1);
  assert.equal(received[0].from, "docysign@company.example");
});

function fakeMicrosoft() {
  const calls = [];
  let denyDrafts = false;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = req.url;
      calls.push({ method: req.method, url, auth: req.headers.authorization || "", range: req.headers["content-range"] || "", body });
      const json = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(data ? JSON.stringify(data) : "");
      };
      if (url.endsWith("/oauth2/v2.0/token")) {
        const form = new URLSearchParams(body.toString());
        if (form.get("client_secret") !== "s3cret") {
          return json(401, { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." });
        }
        return json(200, { access_token: "token-123", expires_in: 3600 });
      }
      if (url.endsWith("/sendMail")) return json(202);
      if (req.method === "POST" && url.endsWith("/messages")) {
        if (denyDrafts) return json(403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } });
        return json(201, { id: "draft-1" });
      }
      if (url.endsWith("/createUploadSession")) {
        return json(201, { uploadUrl: `http://127.0.0.1:${server.address().port}/upload/abc` });
      }
      if (url === "/upload/abc") return json(req.headers["content-range"].startsWith("bytes 0-") ? 200 : 201, {});
      if (url.endsWith("/send")) return json(202);
      json(404, { error: { code: "ResourceNotFound", message: "nope" } });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      process.env.MS_LOGIN_URL = base;
      process.env.MS_GRAPH_URL = `${base}/v1.0`;
      resolve({ server, calls, setDenyDrafts: (v) => { denyDrafts = v; } });
    });
  });
}

const graphSettings = { provider: "graph", tenantId: "tenant-1", clientId: "client-1", clientSecret: "s3cret", fromName: "DocySign", fromEmail: "sign@contoso.example" };

test("Microsoft 365 through Graph: sign-in, message and small attachment", async () => {
  const ms = await fakeMicrosoft();
  const pdfPath = path.join(tmp, "small.pdf");
  fs.writeFileSync(pdfPath, "%PDF-1.7 small");
  assert.equal(smtp.isConfigured(graphSettings), true);
  assert.equal(smtp.isConfigured({ ...graphSettings, clientSecret: "" }), false);
  const results = await smtp.sendCompletedEmails(graphSettings, { envelope, origin: "https://sign.example.com", pdfPath, owner: null });
  ms.server.close();
  assert.equal(results[0].sent, true, JSON.stringify(results));
  const token = ms.calls.find((c) => c.url.endsWith("/token"));
  assert.match(token.url, /^\/tenant-1\//);
  assert.match(token.body.toString(), /grant_type=client_credentials/);
  const sent = ms.calls.find((c) => c.url.endsWith("/sendMail"));
  assert.equal(sent.url, "/v1.0/users/sign%40contoso.example/sendMail");
  assert.equal(sent.auth, "Bearer token-123");
  const { message } = JSON.parse(sent.body.toString());
  assert.equal(message.toRecipients[0].emailAddress.address, "khalid@example.com");
  assert.equal(message.attachments[0].name, "Service_Agreement_signed.pdf");
  assert.equal(Buffer.from(message.attachments[0].contentBytes, "base64").toString(), "%PDF-1.7 small");
});

test("Microsoft 365 through Graph: a large PDF is uploaded in pieces", async () => {
  const ms = await fakeMicrosoft();
  const pdfPath = path.join(tmp, "large.pdf");
  const size = 5 * 1024 * 1024;
  fs.writeFileSync(pdfPath, Buffer.alloc(size, 1));
  const settings = { ...graphSettings, clientId: "client-2" };
  const results = await smtp.sendCompletedEmails(settings, { envelope, origin: "https://sign.example.com", pdfPath, owner: null });
  assert.equal(results[0].sent, true, JSON.stringify(results));
  const uploads = ms.calls.filter((c) => c.url === "/upload/abc");
  assert.equal(uploads.length, 2);
  assert.equal(uploads.reduce((n, c) => n + c.body.length, 0), size);
  assert.equal(uploads[0].auth, "", "the upload address is not sent the token");
  assert.match(uploads[1].range, new RegExp(`/${size}$`));
  assert.ok(ms.calls.some((c) => c.url.endsWith("/messages/draft-1/send")));

  // Without permission to save drafts the message still goes out, unattached.
  ms.calls.length = 0;
  ms.setDenyDrafts(true);
  const again = await smtp.sendCompletedEmails(settings, { envelope, origin: "https://sign.example.com", pdfPath, owner: null });
  ms.server.close();
  assert.equal(again[0].sent, true);
  assert.equal(again[0].attachmentDropped, true);
  const fallback = JSON.parse(ms.calls.find((c) => c.url.endsWith("/sendMail")).body.toString());
  assert.equal(fallback.message.attachments, undefined);
  assert.match(fallback.message.body.content, /too large to attach/);
});

test("Microsoft 365 through Graph: a bad client secret gives a clear message", async () => {
  const ms = await fakeMicrosoft();
  const results = await smtp.sendRequestEmails({ ...graphSettings, clientSecret: "wrong" }, {
    senderName: "Sara", senderEmail: "sara@example.com", envelope, origin: "https://x.example", signers: envelope.signers,
  });
  ms.server.close();
  assert.equal(results[0].sent, false);
  assert.match(results[0].error, /rejected the client secret/);
});
