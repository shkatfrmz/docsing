import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Logo from "../components/Logo.jsx";
import PdfViewer from "../components/PdfViewer.jsx";
import SignaturePad from "../components/SignaturePad.jsx";

export default function Sign() {
  const { token } = useParams();
  const { user } = useAuth();
  const [info, setInfo] = useState(null);
  const [values, setValues] = useState({});
  const [active, setActive] = useState(null);
  const [draw, setDraw] = useState("");
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState("draw");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [reason, setReason] = useState("");
  const [savedSig, setSavedSig] = useState({ signature: "", initials: "" });

  useEffect(() => {
    api.signInfo(token)
      .then((data) => {
        setInfo(data);
        setTyped(data.signer.name || "");
        if (data.signer.status === "signed") {
          setDone(true);
          setCompleted(data.status === "completed");
        }
        if (data.signer.status === "declined" || data.status === "declined" || data.status === "voided") {
          setDeclined(true);
        }
      })
      .catch((e) => setError(e.message));
    if (user) api.signature().then(setSavedSig).catch(() => {});
  }, [token, user]);

  const fields = useMemo(() => {
    if (!info) return [];
    return info.fields.map((f) => ({ ...f, value: values[f.id] || f.value || "" }));
  }, [info, values]);

  function applyValue(val) {
    if (!active) return;
    setValues((prev) => ({ ...prev, [active.id]: val }));
  }

  function typedSignature(name) {
    const canvas = document.createElement("canvas");
    canvas.width = 520;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0b1f3a";
    ctx.font = "italic 54px Georgia, serif";
    ctx.fillText(name, 24, 100);
    return canvas.toDataURL("image/png");
  }

  function saveField() {
    if (!active) return;
    if (active.type === "checkbox") {
      applyValue("Yes");
    } else if (active.type === "signature" || active.type === "initials") {
      const saved = active.type === "initials" ? savedSig.initials : savedSig.signature;
      const img = mode === "saved" && saved
        ? saved
        : mode === "type"
          ? typedSignature(typed || info.signer.name)
          : draw;
      if (!img) {
        setError("Draw, type, or use your saved signature first");
        return;
      }
      applyValue(img);
    } else if (active.type === "date") {
      applyValue(typed || new Date().toLocaleDateString());
    } else if (active.type === "name") {
      applyValue(typed || info.signer.name);
    } else {
      if (!typed) {
        setError("Enter a value");
        return;
      }
      applyValue(typed);
    }
    setActive(null);
    setError("");
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      const missing = fields.filter((f) => f.required && !values[f.id] && !f.value);
      if (missing.length) {
        throw new Error(`Fill every field first (${missing[0].type} still empty)`);
      }
      const res = await api.sign(token, values);
      setDone(true);
      setCompleted(res.completed);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function declineDoc() {
    setBusy(true);
    setError("");
    try {
      await api.decline(token, reason);
      setDeclined(true);
      setShowDecline(false);
      setInfo((prev) => prev ? {
        ...prev,
        status: "declined",
        declineReason: reason,
        signer: { ...prev.signer, status: "declined" },
      } : prev);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !info) {
    return (
      <div className="page">
        <h1 className="serif">Unable to open document</h1>
        <p className="error">{error}</p>
        <p className="meta">You can still sign from this email link without an account. If the link expired, ask the sender to resend.</p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn btn-primary" to="/signup">Create a free account</Link>
          <Link className="btn btn-ghost" to="/login">Log in</Link>
        </div>
      </div>
    );
  }
  if (!info) return <div className="page">Loading signing session…</div>;

  const invitedEmail = info.signer.email;
  const sameAccount = !!(user && user.email === invitedEmail);
  const signupQs = `email=${encodeURIComponent(invitedEmail)}&name=${encodeURIComponent(info.signer.name || "")}&next=${encodeURIComponent(`/sign/${token}`)}`;

  return (
    <div>
      <header className="topbar">
        <Link to="/" className="brand">
          <Logo size={28} />
        </Link>
        <div className="meta">
          Signing as {info.signer.name} ({info.signer.email})
          {!info.hasAccount && !user && " · no account needed"}
        </div>
      </header>
      <div className="page">
        <div className="page-head">
          <div>
            <div className="kicker">Review and sign</div>
            <h1 className="serif">{info.title}</h1>
            {info.message && <p>{info.message}</p>}
          </div>
          {!done && !declined && !info.waitingOnPrior && info.status === "sent" && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setShowDecline(true)}>
                Decline
              </button>
              <button type="button" className="btn btn-gold" disabled={busy} onClick={finish}>
                {busy ? "Submitting…" : "Finish signing"}
              </button>
            </div>
          )}
        </div>
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        {info.status === "expired" && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>This envelope expired</h3>
            <p className="meta">The signing window closed. Ask the sender to send a new copy if you still need to sign.</p>
          </div>
        )}
        {info.status === "voided" && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>This envelope was voided</h3>
            <p className="meta">
              The sender closed “{info.title}”.
              {info.voidReason ? ` Reason: ${info.voidReason}` : ""}
            </p>
          </div>
        )}
        {info.waitingOnPrior && info.status === "sent" && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Not your turn yet</h3>
            <p className="meta">
              This envelope is signed in order. {info.currentSigner ? `${info.currentSigner.name} signs first.` : "A prior recipient still needs to sign."}
              You will get an email when it is your turn.
            </p>
          </div>
        )}
        {declined && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>{info.signer.status === "declined" ? "You declined this document" : "This envelope was declined"}</h3>
            <p className="meta">
              “{info.title}” is closed. Everyone on the envelope was emailed.
              {info.declineReason || reason ? ` Reason: ${info.declineReason || reason}` : ""}
            </p>
          </div>
        )}
        {done && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Thank you, {info.signer.name}</h3>
            <p className="meta">
              {completed
                ? "All parties have signed. Everyone received an email with the final PDF attached."
                : "Your signature was captured. Other recipients still need to sign. You will get an email when the final PDF is ready."}
            </p>
            {!user && (
              <p className="meta" style={{ marginTop: 8 }}>
                No DocySign account is required to sign. Create a free account with {invitedEmail} if you want this document in a workspace.
              </p>
            )}
            {user && !sameAccount && (
              <p className="meta" style={{ marginTop: 8 }}>
                You are signed in as {user.email}. This invite is for {invitedEmail}. Workspace shows {user.email}’s documents, not this invite, unless you create or log into {invitedEmail}.
              </p>
            )}
            <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
              {completed && (
                <a className="btn btn-primary" href={`/api/sign/${token}/download`}>Download signed PDF</a>
              )}
              {sameAccount && (
                <>
                  {completed && <Link className="btn btn-ghost" to={`/preview/${info.envelopeId}`}>Preview in workspace</Link>}
                  <Link className="btn btn-ghost" to="/app">Go to workspace</Link>
                  <Link className="btn btn-ghost" to="/mail">Open mail</Link>
                </>
              )}
              {!user && (
                <>
                  <Link className="btn btn-gold" to={`/signup?${signupQs}`}>Create account as {invitedEmail}</Link>
                  <Link className="btn btn-ghost" to={`/login?email=${encodeURIComponent(invitedEmail)}&next=${encodeURIComponent(`/sign/${token}`)}`}>I already have an account</Link>
                </>
              )}
            </div>
          </div>
        )}
        <div className="layout-2">
          <aside className="sidebar card">
            <h3>Your fields</h3>
            {fields.map((f) => (
              <button
                type="button"
                key={f.id}
                className="field-chip"
                onClick={() => {
                  if (info.waitingOnPrior) return;
                  if (f.type === "checkbox") {
                    setValues((prev) => ({ ...prev, [f.id]: prev[f.id] === "Yes" ? "" : "Yes" }));
                    return;
                  }
                  setActive(f);
                  setError("");
                  if (f.type === "date") setTyped(new Date().toLocaleDateString());
                  if (f.type === "name") setTyped(info.signer.name);
                  const saved = f.type === "initials" ? savedSig.initials : savedSig.signature;
                  if ((f.type === "signature" || f.type === "initials") && saved) setMode("saved");
                }}
                disabled={done || declined || info.waitingOnPrior}
              >
                <span>{f.type}</span>
                <span>{values[f.id] ? "Filled" : "Required"}</span>
              </button>
            ))}
            <div className="hint">Click a field here or on the document, then adopt your signature.</div>
            <label className="label">All parties</label>
            {info.allSigners.map((s) => (
              <div key={s.id} className="meta" style={{ marginBottom: 6 }}>
                {s.order}. {s.name} — {s.status}
              </div>
            ))}
          </aside>
          <PdfViewer
            src={`/api/sign/${token}/file`}
            fields={fields}
            activeId={active?.id}
            onSelect={(f) => {
              if (done || declined || info.waitingOnPrior) return;
              if (f.type === "checkbox") {
                setValues((prev) => ({ ...prev, [f.id]: prev[f.id] === "Yes" ? "" : "Yes" }));
                return;
              }
              setActive(f);
            }}
            renderValue={(f) => {
              if (f.type === "checkbox") {
                return f.value === "Yes" ? "X" : "";
              }
              if (f.value && f.value.startsWith("data:image")) {
                return <img src={f.value} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
              }
              return f.value || f.type;
            }}
          />
        </div>
      </div>

      {active && !done && !declined && !info.waitingOnPrior && (
        <div className="modal-back" onClick={() => setActive(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">Fill field</div>
            <h2 className="serif" style={{ margin: "6px 0 14px" }}>{active.type}</h2>
            {(active.type === "signature" || active.type === "initials") && (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  {(active.type === "signature" ? savedSig.signature : savedSig.initials) && (
                    <button type="button" className={`btn btn-sm ${mode === "saved" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("saved")}>Saved</button>
                  )}
                  <button type="button" className={`btn btn-sm ${mode === "draw" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("draw")}>Draw</button>
                  <button type="button" className={`btn btn-sm ${mode === "type" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("type")}>Type</button>
                </div>
                {mode === "saved" ? (
                  <img
                    src={active.type === "initials" ? savedSig.initials : savedSig.signature}
                    alt="Saved signature"
                    style={{ width: "100%", maxHeight: 120, objectFit: "contain", background: "#fff", borderRadius: 8 }}
                  />
                ) : mode === "draw" ? (
                  <SignaturePad onChange={setDraw} />
                ) : (
                  <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
                )}
              </>
            )}
            {active.type === "name" && (
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
            )}
            {active.type === "text" && (
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Enter text" />
            )}
            {active.type === "date" && (
              <input className="input" value={typed || new Date().toLocaleDateString()} onChange={(e) => setTyped(e.target.value)} />
            )}
            <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setActive(null)}>Cancel</button>
              <button type="button" className="btn btn-gold" onClick={saveField}>Adopt and continue</button>
            </div>
          </div>
        </div>
      )}

      {showDecline && !declined && (
        <div className="modal-back" onClick={() => setShowDecline(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">Decline to sign</div>
            <h2 className="serif" style={{ margin: "6px 0 14px" }}>Close this envelope?</h2>
            <p className="meta">Everyone on “{info.title}” will be emailed. No further signatures will be collected.</p>
            <label className="label">Reason (optional)</label>
            <textarea
              className="input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="I cannot sign this document because…"
            />
            <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowDecline(false)}>Keep reviewing</button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={declineDoc}>
                {busy ? "Declining…" : "Decline and notify"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
