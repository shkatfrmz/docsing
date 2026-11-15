// Sends mail through Microsoft 365 with the Microsoft Graph API, signing in
// as an app registration (OAuth client credentials). This is the route
// Microsoft supports long term; password sign-in over SMTP is being retired.
const fs = require("fs");

const INLINE_LIMIT = 3 * 1024 * 1024; // Graph caps a sendMail request at 4 MB
const CHUNK = 320 * 1024 * 10; // upload sessions want multiples of 320 KiB

function loginUrl() {
  return (process.env.MS_LOGIN_URL || "https://login.microsoftonline.com").replace(/\/+$/, "");
}

function graphUrl() {
  return (process.env.MS_GRAPH_URL || "https://graph.microsoft.com/v1.0").replace(/\/+$/, "");
}

function isConfigured(settings) {
  return !!(settings && settings.tenantId && settings.clientId && settings.clientSecret && settings.fromEmail);
}

const tokens = new Map();

function explain(status, code, message) {
  const text = `${code || ""} ${message || ""}`;
  if (/AADSTS7000215|invalid_client/i.test(text)) {
    return "Microsoft rejected the client secret. Create a new secret in the app registration and save its Value (not its ID).";
  }
  if (/AADSTS700016|unauthorized_client/i.test(text)) {
    return "Microsoft does not recognise this application (client) ID in that tenant.";
  }
  if (/AADSTS90002|AADSTS900023|invalid_tenant/i.test(text)) {
    return "Microsoft does not recognise this directory (tenant) ID.";
  }
  if (status === 403 || /ErrorAccessDenied|Authorization_RequestDenied/i.test(text)) {
    return "Microsoft refused the request. The app registration needs the Mail.Send application permission, with admin consent granted.";
  }
  if (status === 404 || /ErrorInvalidUser|ResourceNotFound|MailboxNotEnabledForRESTAPI/i.test(text)) {
    return "The From address is not a mailbox in this Microsoft 365 tenant.";
  }
  return `Microsoft 365 error (${status}): ${message || code || "request failed"}`;
}

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    throw new Error(`Could not reach Microsoft 365: ${err.message}`);
  }
  if (res.ok) return res;
  const data = await res.json().catch(() => ({}));
  const err = data.error || {};
  const code = typeof err === "string" ? err : err.code;
  const message = data.error_description || err.message || "";
  const failure = new Error(explain(res.status, code, message));
  failure.status = res.status;
  throw failure;
}

async function getToken(settings) {
  const key = `${settings.tenantId}|${settings.clientId}|${settings.clientSecret}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now() + 60000) return cached.value;
  const res = await request(`${loginUrl()}/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  tokens.set(key, { value: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3000) * 1000 });
  return data.access_token;
}

function buildMessage(settings, { to, toName, subject, html }) {
  return {
    subject: String(subject || "").replace(/[\r\n]+/g, " "),
    body: { contentType: "HTML", content: html },
    toRecipients: [{ emailAddress: { address: to, ...(toName ? { name: toName } : {}) } }],
  };
}

// Messages too big for one request: save a draft, upload each file in
// pieces, then send the draft. Needs the Mail.ReadWrite permission as well.
async function sendLarge(settings, token, message, files) {
  const base = `${graphUrl()}/users/${encodeURIComponent(settings.fromEmail)}`;
  const json = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const draft = await (await request(`${base}/messages`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(message),
  })).json();
  for (const file of files) {
    const session = await (await request(`${base}/messages/${draft.id}/attachments/createUploadSession`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: file.filename,
          size: file.bytes.length,
          contentType: file.contentType || "application/octet-stream",
        },
      }),
    })).json();
    for (let start = 0; start < file.bytes.length; start += CHUNK) {
      const piece = file.bytes.subarray(start, Math.min(start + CHUNK, file.bytes.length));
      // The upload address carries its own authorisation.
      await request(session.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(piece.length),
          "Content-Range": `bytes ${start}-${start + piece.length - 1}/${file.bytes.length}`,
        },
        body: piece,
      });
    }
  }
  await request(`${base}/messages/${draft.id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Length": "0" },
  });
}

async function send(settings, mail) {
  const token = await getToken(settings);
  const files = (mail.attachments || [])
    .filter((a) => a && a.path && fs.existsSync(a.path))
    .map((a) => ({ filename: a.filename, contentType: a.contentType, bytes: fs.readFileSync(a.path) }));
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  const message = buildMessage(settings, mail);
  const url = `${graphUrl()}/users/${encodeURIComponent(settings.fromEmail)}/sendMail`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  if (total > INLINE_LIMIT) {
    try {
      await sendLarge(settings, token, message, files);
      return { sent: true, skipped: false };
    } catch (err) {
      if (err.status !== 403) throw err;
      // Without Mail.ReadWrite the file cannot be attached. Deliver the
      // message anyway, saying so; its button still opens the document.
      const note =
        '<p style="font-family:Arial,sans-serif;font-size:13px;color:#6a6a6a;margin:0 0 12px;">' +
        "The PDF was too large to attach to this email. Use the button below to open and download it.</p>";
      message.body.content = message.body.content.replace(/(<body[^>]*>)/i, `$1${note}`);
      await request(url, { method: "POST", headers, body: JSON.stringify({ message }) });
      return { sent: true, skipped: false, attachmentDropped: true };
    }
  }

  if (files.length) {
    message.attachments = files.map((f) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: f.filename,
      contentType: f.contentType || "application/octet-stream",
      contentBytes: f.bytes.toString("base64"),
    }));
  }
  await request(url, { method: "POST", headers, body: JSON.stringify({ message }) });
  return { sent: true, skipped: false };
}

module.exports = { send, isConfigured };
