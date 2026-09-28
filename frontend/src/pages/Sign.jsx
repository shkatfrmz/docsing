import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import PdfViewer from "../components/PdfViewer.jsx";
import SignaturePad from "../components/SignaturePad.jsx";

export default function Sign() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [values, setValues] = useState({});
  const [active, setActive] = useState(null);
  const [draw, setDraw] = useState("");
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState("draw");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.signInfo(token)
      .then((data) => {
        setInfo(data);
        setTyped(data.signer.name || "");
        if (data.signer.status === "signed") {
          setDone(true);
          setCompleted(data.status === "completed");
        }
      })
      .catch((e) => setError(e.message));
  }, [token]);

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
    if (active.type === "signature" || active.type === "initials") {
      const img = mode === "type" ? typedSignature(typed || info.signer.name) : draw;
      if (!img) {
        setError("Draw or type a signature first");
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

  if (error && !info) {
    return (
      <div className="page">
        <h1 className="serif">Unable to open document</h1>
        <p className="error">{error}</p>
        <Link className="btn btn-ghost" to="/login">Log in</Link>
      </div>
    );
  }
  if (!info) return <div className="page">Loading signing session…</div>;

  return (
    <div>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" />
          DocySign
        </Link>
        <div className="meta">Signing as {info.signer.name} ({info.signer.email})</div>
      </header>
      <div className="page">
        <div className="page-head">
          <div>
            <div className="kicker">Review and sign</div>
            <h1 className="serif">{info.title}</h1>
            {info.message && <p>{info.message}</p>}
          </div>
          {!done && (
            <button type="button" className="btn btn-gold" disabled={busy} onClick={finish}>
              {busy ? "Submitting…" : "Finish signing"}
            </button>
          )}
        </div>
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        {done && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Thank you, {info.signer.name}</h3>
            <p className="meta">
              {completed
                ? "All parties have signed. Everyone received an email, and the final PDF is in each workspace."
                : "Your signature was captured. Other recipients still need to sign. You will get an email when the final PDF is ready."}
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              {completed && (
                <>
                  <Link className="btn btn-primary" to={`/preview/${info.envelopeId}`}>Preview / print</Link>
                  <a className="btn btn-ghost" href={`/api/sign/${token}/download`}>Download signed PDF</a>
                </>
              )}
              <Link className="btn btn-ghost" to="/app">Go to workspace</Link>
              <Link className="btn btn-ghost" to="/mail">Open mail</Link>
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
                  setActive(f);
                  setError("");
                  if (f.type === "date") setTyped(new Date().toLocaleDateString());
                  if (f.type === "name") setTyped(info.signer.name);
                }}
                disabled={done}
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
            onSelect={(f) => !done && setActive(f)}
            renderValue={(f) => {
              if (f.value && f.value.startsWith("data:image")) {
                return <img src={f.value} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
              }
              return f.value || f.type;
            }}
          />
        </div>
      </div>

      {active && !done && (
        <div className="modal-back" onClick={() => setActive(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">Fill field</div>
            <h2 className="serif" style={{ margin: "6px 0 14px" }}>{active.type}</h2>
            {(active.type === "signature" || active.type === "initials") && (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <button type="button" className={`btn btn-sm ${mode === "draw" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("draw")}>Draw</button>
                  <button type="button" className={`btn btn-sm ${mode === "type" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("type")}>Type</button>
                </div>
                {mode === "draw" ? (
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
    </div>
  );
}
