import { useEffect, useState } from "react";
import { api } from "../api.js";

const GMAIL = { host: "smtp.gmail.com", port: 587, secure: false };
const POSTFIX = { host: "localhost", port: 587, secure: false };

export default function Settings({ embedded }) {
  const [form, setForm] = useState({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    fromName: "DocySign",
    fromEmail: "",
  });
  const [configured, setConfigured] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api.smtp()
      .then((s) => {
        setForm((prev) => ({
          ...prev,
          host: s.host || prev.host,
          port: s.port || prev.port,
          secure: !!s.secure,
          user: s.user || "",
          fromName: s.fromName || "DocySign",
          fromEmail: s.fromEmail || "",
        }));
        setConfigured(!!s.configured);
        setHasPassword(!!s.hasPassword);
      })
      .catch((e) => setError(e.message));
  }, []);

  function applyPreset(preset) {
    setForm((prev) => ({ ...prev, ...preset }));
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
      setConfigured(!!saved.configured);
      setHasPassword(!!saved.hasPassword);
      setForm((prev) => ({ ...prev, pass: "" }));
      setOk(saved.configured ? "SMTP saved. Recipients will get real emails." : "Saved, but host, user, and password are all required to send.");
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
              Product-wide SMTP. Recipients get real signing links and completed PDFs.
              Use a Gmail app password or Postfix. Credentials stay on this server.
            </p>
          </div>
        </div>
      )}

      <div className="card settings-card">
        <div className="row" style={{ gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset(GMAIL)}>
            Gmail
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset(POSTFIX)}>
            Postfix
          </button>
          <span className={`badge ${configured ? "badge-completed" : "badge-draft"}`}>
            {configured ? "SMTP ready" : "Not configured"}
          </span>
        </div>

        <form onSubmit={save}>
          <label className="label">SMTP host</label>
          <input
            className="input"
            value={form.host}
            onChange={(e) => setField("host", e.target.value)}
            placeholder="smtp.gmail.com or mail.yourdomain.com"
            required
          />

          <div className="row" style={{ gap: 16, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Port</label>
              <input
                className="input"
                type="number"
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

          <label className="label" style={{ marginTop: 12 }}>Username</label>
          <input
            className="input"
            value={form.user}
            onChange={(e) => setField("user", e.target.value)}
            placeholder="you@gmail.com"
            required
          />

          <label className="label" style={{ marginTop: 12 }}>
            Password {hasPassword ? "(saved — leave blank to keep)" : ""}
          </label>
          <input
            className="input"
            type="password"
            value={form.pass}
            onChange={(e) => setField("pass", e.target.value)}
            placeholder={hasPassword ? "••••••••" : "Gmail app password or Postfix password"}
            autoComplete="new-password"
          />

          <label className="label" style={{ marginTop: 12 }}>From name</label>
          <input
            className="input"
            value={form.fromName}
            onChange={(e) => setField("fromName", e.target.value)}
          />

          <label className="label" style={{ marginTop: 12 }}>From email</label>
          <input
            className="input"
            type="email"
            value={form.fromEmail}
            onChange={(e) => setField("fromEmail", e.target.value)}
            placeholder="same as username unless your server allows aliases"
          />

          {error && <div className="error">{error}</div>}
          {ok && <div className="ok">{ok}</div>}

          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 18 }}>
            {busy ? "Saving…" : "Save SMTP"}
          </button>
        </form>
      </div>

      <div className="card settings-card" style={{ marginTop: 16 }}>
        <h3 className="serif" style={{ marginTop: 0 }}>Send a test</h3>
        <p className="meta">Confirms Gmail or Postfix can deliver from this workspace.</p>
        <label className="label">Send test to</label>
        <input
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
