import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, downloadUrl } from "../api.js";
import { useAuth } from "../auth.jsx";
import PdfViewer from "../components/PdfViewer.jsx";

function badgeClass(status) {
  if (status === "completed" || status === "signed") return "badge badge-completed";
  if (status === "declined" || status === "voided") return "badge badge-declined";
  if (status === "expired" || status === "waiting") return "badge badge-expired";
  if (status === "sent" || status === "pending") return "badge badge-sent";
  return "badge badge-draft";
}

export default function Envelope() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [env, setEnv] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  useEffect(() => {
    api.get(id).then(setEnv).catch((e) => setError(e.message));
  }, [id]);

  async function copyLink(path) {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      setCopied(url);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this envelope?")) return;
    await api.remove(id);
    nav("/app");
  }

  async function duplicate() {
    setBusy(true);
    setError("");
    try {
      const copy = await api.duplicate(id);
      nav(`/prepare/${copy.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api.saveTemplate(id, env.title);
      setOk("Saved as a template. Use it from the Templates tab in Workspace.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function voidEnvelope() {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const next = await api.voidEnvelope(id, voidReason);
      setEnv(next);
      setShowVoid(false);
      setOk("Envelope voided. Every party was notified.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remind(signerId) {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const next = await api.remind(id, signerId);
      setEnv(next);
      setOk(signerId ? "Reminder sent." : "Reminders sent to everyone still waiting.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!env) {
    return (
      <div className="page">
        <h1 className="serif">Unable to open envelope</h1>
        <p className="error">{error || "Loading…"}</p>
        <p className="meta">
          This page is for people who have a DocySign account with the invited email.
          Guests should use the Review and sign link from the email — no login required.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn btn-primary" to="/app">Workspace</Link>
          <Link className="btn btn-ghost" to="/signup">Create account</Link>
        </div>
      </div>
    );
  }

  const mySigner = env.signers.find((s) => s.email.toLowerCase() === user.email && s.token);
  const downloadHref = downloadUrl(id);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Envelope</div>
          <h1 className="serif">{env.title}</h1>
          <p>{env.fileName}</p>
        </div>
        <div className="row">
          <span className={badgeClass(env.status)}>{env.status}</span>
          <Link className="btn btn-ghost" to={`/preview/${id}`}>Preview / Print</Link>
          <a className="btn btn-primary" href={downloadHref}>Download PDF</a>
          {env.status === "sent" && env.signers.some((s) => s.status === "pending" || s.status === "waiting") && (
            <button type="button" className="btn btn-gold" disabled={busy} onClick={() => remind()}>
              {busy ? "Sending…" : env.signingOrder ? "Remind current signer" : "Remind all pending"}
            </button>
          )}
          {env.status === "sent" && env.ownerId === user.id && (
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => setShowVoid(true)}>
              Void
            </button>
          )}
          {env.ownerId === user.id && (
            <>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={duplicate}>Duplicate</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={saveTemplate}>Save as template</button>
            </>
          )}
          {env.status === "draft" && <Link className="btn btn-ghost" to={`/prepare/${id}`}>Edit</Link>}
          <button type="button" className="btn btn-danger btn-sm" onClick={remove}>Delete</button>
        </div>
      </div>

      <div className="layout-2">
        <aside className="sidebar">
          <div className="card">
            <h3>Recipients</h3>
            {env.signers.map((s) => (
              <div key={s.id} className="signer-item">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{s.name}</strong>
                  <span className={badgeClass(s.status)}>{s.status}</span>
                </div>
                <div className="meta">{s.email} · {s.role}</div>
                {s.token && env.status === "sent" && s.status === "pending" && (
                  <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                    <Link className="btn btn-gold btn-sm" to={`/sign/${s.token}`}>
                      {s.email.toLowerCase() === user.email ? "Sign now" : "Open signing page"}
                    </Link>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyLink(`/sign/${s.token}`)}>
                      Copy link
                    </button>
                    {env.ownerId === user.id && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remind(s.id)}>
                        Remind
                      </button>
                    )}
                  </div>
                )}
                {s.lastRemindedAt && s.status === "pending" && (
                  <div className="meta" style={{ marginTop: 4 }}>Last reminded {new Date(s.lastRemindedAt).toLocaleString()}</div>
                )}
              </div>
            ))}
            {copied && <div className="ok">Copied: {copied}</div>}
            {ok && <div className="ok">{ok}</div>}
            {error && <div className="error">{error}</div>}
            {(env.cc || []).length > 0 && (
              <>
                <h3 style={{ marginTop: 16 }}>Copied</h3>
                {env.cc.map((c) => (
                  <div key={c.id} className="meta" style={{ marginBottom: 4 }}>{c.name} · {c.email}</div>
                ))}
              </>
            )}
            {env.signingOrder && <p className="meta" style={{ marginTop: 8 }}>Sequential routing is on. Each person is emailed when it is their turn.</p>}
            {env.expiresAt && env.status === "sent" && (
              <p className="meta" style={{ marginTop: 8 }}>Expires {new Date(env.expiresAt).toLocaleString()}</p>
            )}
            {env.status === "declined" && (
              <p className="meta" style={{ marginTop: 8 }}>
                This envelope was declined{env.declineReason ? `: ${env.declineReason}` : "."}
              </p>
            )}
            {env.status === "voided" && (
              <p className="meta" style={{ marginTop: 8 }}>
                This envelope was voided{env.voidReason ? `: ${env.voidReason}` : "."}
              </p>
            )}
            {env.status === "expired" && (
              <p className="meta" style={{ marginTop: 8 }}>This envelope expired and is closed.</p>
            )}
            <p className="hint">
              Recipients receive an email with a signing link. Remind pending people from here. When everyone signs, the final PDF is emailed and added to Completed.
            </p>
            {mySigner && env.status === "sent" && mySigner.status === "pending" && (
              <Link className="btn btn-gold" to={`/sign/${mySigner.token}`} style={{ marginTop: 8, display: "inline-block" }}>
                Sign this document
              </Link>
            )}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Audit trail</h3>
            <ul className="audit">
              {(env.audit || []).slice().reverse().map((a) => (
                <li key={a.id}>
                  <div><strong>{a.actor}</strong> — {a.action}</div>
                  <div className="meta">{new Date(a.at).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <PdfViewer
          src={`/api/envelopes/${id}/file`}
          fields={env.status === "completed" ? [] : env.fields}
          renderValue={(f) => (f.value && !f.value.startsWith("data:") ? f.value : f.type)}
        />
      </div>

      {showVoid && (
        <div className="modal-back" onClick={() => setShowVoid(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">Void envelope</div>
            <h2 className="serif" style={{ margin: "6px 0 14px" }}>Close “{env.title}”?</h2>
            <p className="meta">Everyone on the envelope will be emailed. No further signatures will be collected.</p>
            <label className="label">Reason (optional)</label>
            <textarea
              className="input"
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Wrong document, terms changed…"
            />
            <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowVoid(false)}>Keep open</button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={voidEnvelope}>
                {busy ? "Voiding…" : "Void and notify"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
