import { useEffect, useState } from "react";
import { api } from "../api.js";

// Each mail service the app knows how to talk to. `provider` is "smtp" for
// anything that speaks SMTP and "graph" for Microsoft 365 through its API.
// Hosts and ports are starting points and can be edited.
const SERVICES = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    provider: "smtp",
    values: { host: "smtp.gmail.com", port: 587, secure: false, noAuth: false },
    userHint: "you@gmail.com",
    passHint: "16-character app password",
    note: "Use an app password, not your normal password. The Google account needs 2-step verification turned on.",
  },
  {
    id: "m365-graph",
    label: "Microsoft 365 (recommended)",
    provider: "graph",
    note:
      "Signs in as an app registration instead of with a password. In Microsoft Entra: register an app, add the " +
      "Mail.Send application permission and grant admin consent, then create a client secret. The From address " +
      "must be a real mailbox or shared mailbox in your tenant. Add Mail.ReadWrite as well if signed PDFs can be larger than 3 MB.",
  },
  {
    id: "m365-smtp",
    label: "Microsoft 365 (SMTP with password)",
    provider: "smtp",
    values: { host: "smtp.office365.com", port: 587, secure: false, noAuth: false },
    userHint: "mailbox@yourcompany.com",
    passHint: "Mailbox password or app password",
    note:
      "Microsoft is retiring password sign-in for SMTP: it is switched off by default from the end of December 2026. " +
      "SMTP AUTH must also be enabled for this mailbox. Prefer the recommended Microsoft 365 option or a relay.",
  },
  {
    id: "local-relay",
    label: "Internal relay (IIS SMTP, Exchange, Postfix)",
    provider: "smtp",
    values: { host: "", port: 25, secure: false, noAuth: true, allowSelfSigned: true },
    hostHint: "IP address or name of the relay, e.g. 10.0.0.25",
    note:
      "For a relay on your own network that forwards to Microsoft 365 or elsewhere. Enter its IP address, and on " +
      "the relay allow this server's IP address to relay. No username or password is used. The From address must " +
      "be one the relay and your mail system accept.",
  },
  {
    id: "acs",
    label: "Azure Communication Services",
    provider: "smtp",
    values: { host: "smtp.azurecomm.net", port: 587, secure: false, noAuth: false },
    userHint: "SMTP username created in the Azure portal",
    passHint: "Client secret of the linked Entra application",
    note:
      "In the Communication Services resource, create an SMTP username linked to an Entra application. The From " +
      "address must be a sender address on a domain connected to that resource.",
  },
  {
    id: "ses",
    label: "Amazon SES",
    provider: "smtp",
    values: { host: "email-smtp.us-east-1.amazonaws.com", port: 587, secure: false, noAuth: false },
    userHint: "SES SMTP username",
    passHint: "SES SMTP password",
    note: "Change the region in the host to yours. Use SES SMTP credentials, which are different from AWS access keys.",
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    provider: "smtp",
    values: { host: "smtp.sendgrid.net", port: 587, secure: false, noAuth: false, user: "apikey" },
    passHint: "SendGrid API key",
    note: "The username is the literal word apikey. The password is an API key with mail-send access.",
  },
  {
    id: "mailgun",
    label: "Mailgun",
    provider: "smtp",
    values: { host: "smtp.mailgun.org", port: 587, secure: false, noAuth: false },
    userHint: "postmaster@your-domain",
    passHint: "SMTP password for that domain",
    note: "For an EU account use smtp.eu.mailgun.org.",
  },
  {
    id: "brevo",
    label: "Brevo",
    provider: "smtp",
    values: { host: "smtp-relay.brevo.com", port: 587, secure: false, noAuth: false },
    userHint: "SMTP login shown in Brevo",
    passHint: "SMTP key",
  },
  {
    id: "postmark",
    label: "Postmark",
    provider: "smtp",
    values: { host: "smtp.postmarkapp.com", port: 587, secure: false, noAuth: false },
    userHint: "Server API token",
    passHint: "The same server API token",
    note: "The server API token is used as both username and password.",
  },
  {
    id: "resend",
    label: "Resend",
    provider: "smtp",
    values: { host: "smtp.resend.com", port: 587, secure: false, noAuth: false, user: "resend" },
    passHint: "Resend API key",
    note: "The username is the literal word resend.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    provider: "smtp",
    values: { host: "smtp.zoho.com", port: 587, secure: false, noAuth: false },
    userHint: "you@yourdomain.com",
    passHint: "App-specific password",
  },
  {
    id: "custom",
    label: "Other SMTP server",
    provider: "smtp",
    values: {},
    hostHint: "mail.yourdomain.com",
    note: "Any server that speaks SMTP. Use port 587, or 465 with TLS on connect.",
  },
];

const EMPTY = {
  provider: "smtp",
  preset: "gmail",
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  noAuth: false,
  allowSelfSigned: false,
  user: "",
  pass: "",
  tenantId: "",
  clientId: "",
  clientSecret: "",
  fromName: "DocySign",
  fromEmail: "",
};

export default function Settings({ embedded }) {
  const [form, setForm] = useState(EMPTY);
  const [configured, setConfigured] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [hasClientSecret, setHasClientSecret] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  function applySaved(s) {
    setConfigured(!!s.configured);
    setHasPassword(!!s.hasPassword);
    setHasClientSecret(!!s.hasClientSecret);
  }

  useEffect(() => {
    api.smtp()
      .then((s) => {
        setForm((prev) => ({
          ...prev,
          provider: s.provider || "smtp",
          preset: SERVICES.some((x) => x.id === s.preset) ? s.preset : "custom",
          host: s.host || prev.host,
          port: s.port || prev.port,
          secure: !!s.secure,
          noAuth: !!s.noAuth,
          allowSelfSigned: !!s.allowSelfSigned,
          user: s.user || "",
          tenantId: s.tenantId || "",
          clientId: s.clientId || "",
          fromName: s.fromName || "DocySign",
          fromEmail: s.fromEmail || "",
        }));
        applySaved(s);
      })
      .catch((e) => setError(e.message));
  }, []);

  const service = SERVICES.find((s) => s.id === form.preset) || SERVICES[SERVICES.length - 1];
  const isGraph = form.provider === "graph";

  function chooseService(id) {
    const next = SERVICES.find((s) => s.id === id);
    if (!next) return;
    setOk("");
    setError("");
    setForm((prev) => ({
      ...prev,
      preset: next.id,
      provider: next.provider,
      allowSelfSigned: false,
      user: "",
      ...(next.values || {}),
    }));
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      const saved = await api.saveSmtp(form);
      applySaved(saved);
      setForm((prev) => ({ ...prev, pass: "", clientSecret: "" }));
      setOk(
        saved.configured
          ? "Saved. Send a test below to confirm delivery."
          : "Saved, but something required is still missing, so email cannot be sent yet."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setError("");
    setOk("");
    try {
      const res = await api.testSmtp(testTo);
      setOk(`Test email sent to ${res.to}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  const body = (
    <>
      {!embedded && (
        <div className="page-head">
          <div>
            <div className="kicker">Admin</div>
            <h1 className="serif">Email settings</h1>
            <p>
              How DocySign sends signing links and completed PDFs. Credentials stay on this server.
            </p>
          </div>
        </div>
      )}

      <div className="card settings-card">
        <form onSubmit={save}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <label className="label" htmlFor="mail-service" style={{ margin: 0 }}>Mail service</label>
            <span className={`badge ${configured ? "badge-completed" : "badge-draft"}`}>
              {configured ? "Email ready" : "Not configured"}
            </span>
          </div>
          <select
            id="mail-service"
            className="input"
            style={{ marginTop: 8 }}
            value={form.preset}
            onChange={(e) => chooseService(e.target.value)}
          >
            {SERVICES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          {service.note && <p className="hint" style={{ marginTop: 8 }}>{service.note}</p>}

          {isGraph ? (
            <>
              <label className="label" htmlFor="ms-tenant" style={{ marginTop: 12 }}>Directory (tenant) ID</label>
              <input
                id="ms-tenant"
                className="input"
                value={form.tenantId}
                onChange={(e) => setField("tenantId", e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                required
              />
              <label className="label" htmlFor="ms-client" style={{ marginTop: 12 }}>Application (client) ID</label>
              <input
                id="ms-client"
                className="input"
                value={form.clientId}
                onChange={(e) => setField("clientId", e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                required
              />
              <label className="label" htmlFor="ms-secret" style={{ marginTop: 12 }}>
                Client secret {hasClientSecret ? "(saved — leave blank to keep)" : ""}
              </label>
              <input
                id="ms-secret"
                className="input"
                type="password"
                value={form.clientSecret}
                onChange={(e) => setField("clientSecret", e.target.value)}
                placeholder={hasClientSecret ? "••••••••" : "The secret's Value, not its ID"}
                autoComplete="new-password"
              />
            </>
          ) : (
            <>
              <label className="label" htmlFor="smtp-host" style={{ marginTop: 12 }}>Server address</label>
              <input
                id="smtp-host"
                className="input"
                value={form.host}
                onChange={(e) => setField("host", e.target.value)}
                placeholder={service.hostHint || "Host name or IP address"}
                required
              />

              <div className="row" style={{ gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label className="label" htmlFor="smtp-port">Port</label>
                  <input
                    id="smtp-port"
                    className="input"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => setField("port", Number(e.target.value))}
                    required
                  />
                </div>
                <label className="check-label" style={{ marginTop: 28 }}>
                  <input
                    type="checkbox"
                    checked={form.secure}
                    onChange={(e) => setField("secure", e.target.checked)}
                  />
                  TLS on connect (port 465)
                </label>
              </div>

              <label className="check-label" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={form.noAuth}
                  onChange={(e) => setField("noAuth", e.target.checked)}
                />
                No sign-in: the server trusts this machine's IP address
              </label>
              <label className="check-label" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={form.allowSelfSigned}
                  onChange={(e) => setField("allowSelfSigned", e.target.checked)}
                />
                Accept a self-signed certificate (internal servers only)
              </label>

              {!form.noAuth && (
                <>
                  <label className="label" htmlFor="smtp-user" style={{ marginTop: 12 }}>Username</label>
                  <input
                    id="smtp-user"
                    className="input"
                    value={form.user}
                    onChange={(e) => setField("user", e.target.value)}
                    placeholder={service.userHint || "Username"}
                    required
                  />

                  <label className="label" htmlFor="smtp-pass" style={{ marginTop: 12 }}>
                    Password {hasPassword ? "(saved — leave blank to keep)" : ""}
                  </label>
                  <input
                    id="smtp-pass"
                    className="input"
                    type="password"
                    value={form.pass}
                    onChange={(e) => setField("pass", e.target.value)}
                    placeholder={hasPassword ? "••••••••" : service.passHint || "Password"}
                    autoComplete="new-password"
                  />
                </>
              )}
            </>
          )}

          <label className="label" htmlFor="from-name" style={{ marginTop: 12 }}>From name</label>
          <input
            id="from-name"
            className="input"
            value={form.fromName}
            onChange={(e) => setField("fromName", e.target.value)}
          />

          <label className="label" htmlFor="from-email" style={{ marginTop: 12 }}>From email</label>
          <input
            id="from-email"
            className="input"
            type="email"
            value={form.fromEmail}
            onChange={(e) => setField("fromEmail", e.target.value)}
            placeholder={isGraph ? "A mailbox in your tenant, e.g. sign@yourcompany.com" : "The address recipients see"}
            required={isGraph || form.noAuth}
          />

          {error && <div className="error" role="alert">{error}</div>}
          {ok && <div className="ok">{ok}</div>}

          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 18 }}>
            {busy ? "Saving…" : "Save email settings"}
          </button>
        </form>
      </div>

      <div className="card settings-card" style={{ marginTop: 16 }}>
        <h3 className="serif" style={{ marginTop: 0 }}>Send a test</h3>
        <p className="meta">Sends one message with the saved settings, so save first.</p>
        <label className="label" htmlFor="test-to">Send test to</label>
        <input
          id="test-to"
          className="input"
          type="email"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="you@example.com"
        />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: 16 }}
          disabled={testing || !configured}
          onClick={sendTest}
        >
          {testing ? "Sending…" : "Send test email"}
        </button>
      </div>
    </>
  );

  if (embedded) return body;
  return <div className="page">{body}</div>;
}
