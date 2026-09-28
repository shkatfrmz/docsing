import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import PdfViewer from "../components/PdfViewer.jsx";

const FIELD_TYPES = [
  { type: "signature", label: "Signature", w: 24, h: 8 },
  { type: "initials", label: "Initials", w: 10, h: 7 },
  { type: "name", label: "Full name", w: 22, h: 6 },
  { type: "date", label: "Date signed", w: 16, h: 6 },
  { type: "text", label: "Text", w: 20, h: 6 },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function Prepare() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [env, setEnv] = useState(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [signers, setSigners] = useState([]);
  const [fields, setFields] = useState([]);
  const [placing, setPlacing] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    api.get(id).then((data) => {
      if (data.status !== "draft") {
        nav(`/envelope/${id}`, { replace: true });
        return;
      }
      setEnv(data);
      setTitle(data.title);
      setMessage(data.message || "");
      setSigners(data.signers.length ? data.signers : [{
        id: uid(), name: user.name, email: user.email, role: "signer", order: 1,
      }]);
      setFields(data.fields || []);
    }).catch((e) => setError(e.message));
  }, [id, nav, user]);

  const activeSigner = signers[0]
    ? signers.find((s) => s.id === (placing?.signerId || signers[0].id)) || signers[0]
    : null;

  const payload = useMemo(() => ({ title, message, signers, fields }), [title, message, signers, fields]);

  function addSigner() {
    setSigners((prev) => [...prev, {
      id: uid(), name: "", email: "", role: "signer", order: prev.length + 1,
    }]);
  }

  function updateSigner(sid, patch) {
    setSigners((prev) => prev.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
  }

  function removeSigner(sid) {
    setSigners((prev) => prev.filter((s) => s.id !== sid));
    setFields((prev) => prev.filter((f) => f.signerId !== sid));
  }

  function removeField(fid) {
    setFields((prev) => prev.filter((f) => f.id !== fid));
    setActiveId((cur) => (cur === fid ? null : cur));
  }

  function onPlace({ page, x, y }) {
    if (!placing) return;
    const spec = FIELD_TYPES.find((t) => t.type === placing.type);
    const field = {
      id: uid(),
      type: placing.type,
      signerId: placing.signerId,
      page,
      x: Math.max(0, x - spec.w / 2),
      y: Math.max(0, y - spec.h / 2),
      w: spec.w,
      h: spec.h,
      required: true,
      value: "",
    };
    setFields((prev) => [...prev, field]);
    setActiveId(field.id);
    setPlacing(null);
  }

  useEffect(() => {
    function onKey(e) {
      if (!activeId) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      removeField(activeId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  async function save(send) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      if (send) {
        if (signers.some((s) => !s.name.trim() || !s.email.trim())) {
          throw new Error("Every recipient needs a name and email");
        }
        if (!fields.length) throw new Error("Place at least one field on the PDF");
      }
      await api.update(id, payload);
      if (send) {
        await api.send(id);
        nav(`/envelope/${id}`);
      } else {
        const fresh = await api.get(id);
        setEnv(fresh);
        setSaved("Draft saved");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!env) return <div className="page">{error || "Loading…"}</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Prepare envelope</div>
          <h1 className="serif">{title || "Untitled"}</h1>
        </div>
        <div className="row">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => save(false)}>Save draft</button>
          <button type="button" className="btn btn-gold" disabled={busy} onClick={() => save(true)}>Send for signature</button>
        </div>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      {saved && <div className="ok" style={{ marginBottom: 12 }}>{saved}</div>}
      <div className="layout-2">
        <aside className="sidebar card">
          <label className="label">Document title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="label">Message to signers</label>
          <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please review and sign." />

          <label className="label">Recipients</label>
          {signers.map((s, i) => (
            <div key={s.id} className="signer-item">
              <input className="input" placeholder="Full name" value={s.name} onChange={(e) => updateSigner(s.id, { name: e.target.value })} />
              <div style={{ height: 8 }} />
              <input className="input" type="email" placeholder="Email" value={s.email} onChange={(e) => updateSigner(s.id, { email: e.target.value })} />
              <div style={{ height: 8 }} />
              <select className="input" value={s.role} onChange={(e) => updateSigner(s.id, { role: e.target.value })}>
                <option value="signer">Needs to sign</option>
                <option value="approver">Needs to approve</option>
              </select>
              {signers.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => removeSigner(s.id)}>Remove</button>
              )}
              <div className="hint">Recipient {i + 1}</div>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={addSigner}>Add recipient</button>

          <label className="label">Place a field</label>
          <p className="hint">Select a field, then click the PDF.</p>
          {signers.map((s) => (
            <div key={s.id} style={{ marginBottom: 10 }}>
              <div className="hint" style={{ marginBottom: 6 }}>{s.name || s.email || "Unnamed recipient"}</div>
              {FIELD_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.type}
                  className="field-chip"
                  style={{
                    width: "100%",
                    borderStyle: placing?.type === t.type && placing?.signerId === s.id ? "solid" : "dashed",
                    opacity: placing && placing.signerId !== s.id ? 0.55 : 1,
                  }}
                  onClick={() => setPlacing({ type: t.type, signerId: s.id })}
                >
                  <span>{t.label}</span>
                  <span>{placing?.type === t.type && placing?.signerId === s.id ? "Click page" : "Add"}</span>
                </button>
              ))}
            </div>
          ))}
          {placing && (
            <div className="ok">
              Click on the PDF to drop a {placing.type} field for {activeSigner?.name || "this signer"}.
            </div>
          )}
          {!!fields.length && (
            <>
              <label className="label">Placed fields</label>
              {fields.map((f) => {
                const signer = signers.find((s) => s.id === f.signerId);
                return (
                  <div key={f.id} className="field-chip" style={{ width: "100%" }}>
                    <button
                      type="button"
                      style={{ background: "none", border: 0, padding: 0, textAlign: "left", flex: 1, cursor: "pointer", fontWeight: 600 }}
                      onClick={() => setActiveId(f.id)}
                    >
                      {f.type} · {signer?.name || "signer"}
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeField(f.id)}>
                      Delete
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </aside>
        <PdfViewer
          src={`/api/envelopes/${id}/original`}
          fields={fields}
          activeId={activeId}
          interactive
          onSelect={(f) => setActiveId(f.id)}
          onMove={(fid, pos) => setFields((prev) => prev.map((f) => (f.id === fid ? { ...f, ...pos } : f)))}
          onPlace={onPlace}
          onDelete={removeField}
          renderValue={(f) => {
            const signer = signers.find((s) => s.id === f.signerId);
            return `${f.type} · ${signer?.name || "signer"}`;
          }}
        />
      </div>
    </div>
  );
}
