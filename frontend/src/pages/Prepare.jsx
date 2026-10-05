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
  { type: "checkbox", label: "Checkbox", w: 4, h: 4 },
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
  const [cc, setCc] = useState([]);
  const [signingOrder, setSigningOrder] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [contacts, setContacts] = useState([]);
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
      setCc(data.cc || []);
      setSigningOrder(!!data.signingOrder);
      setExpiresAt(data.expiresAt ? data.expiresAt.slice(0, 10) : "");
    }).catch((e) => setError(e.message));
    api.contacts().then(setContacts).catch(() => {});
  }, [id, nav, user]);

  const activeSigner = signers[0]
    ? signers.find((s) => s.id === (placing?.signerId || signers[0].id)) || signers[0]
    : null;

  const payload = useMemo(() => ({
    title,
    message,
    signers: signers.map((s, i) => ({ ...s, order: i + 1 })),
    fields,
    cc,
    signingOrder,
    expiresAt: expiresAt || null,
  }), [title, message, signers, fields, cc, signingOrder, expiresAt]);

  function addSigner(preset) {
    setSigners((prev) => [...prev, {
      id: uid(),
      name: preset?.name || "",
      email: preset?.email || "",
      role: "signer",
      order: prev.length + 1,
    }]);
  }

  function moveSigner(sid, dir) {
    setSigners((prev) => {
      const idx = prev.findIndex((s) => s.id === sid);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[idx];
      copy[idx] = copy[next];
      copy[next] = tmp;
      return copy.map((s, i) => ({ ...s, order: i + 1 }));
    });
  }

  function addCc(preset) {
    setCc((prev) => [...prev, {
      id: uid(),
      name: preset?.name || "",
      email: preset?.email || "",
    }]);
  }

  function updateCc(cid, patch) {
    setCc((prev) => prev.map((c) => (c.id === cid ? { ...c, ...patch } : c)));
  }

  function removeCc(cid) {
    setCc((prev) => prev.filter((c) => c.id !== cid));
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

          <label className="label">Routing</label>
          <label className="check-label" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={signingOrder} onChange={(e) => setSigningOrder(e.target.checked)} />
            Sign in order (sequential)
          </label>
          <label className="label">Expires (optional)</label>
          <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />

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
              <div className="row" style={{ marginTop: 8 }}>
                {signingOrder && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveSigner(s.id, -1)}>Up</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={i === signers.length - 1} onClick={() => moveSigner(s.id, 1)}>Down</button>
                  </>
                )}
                {signers.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSigner(s.id)}>Remove</button>
                )}
              </div>
              <div className="hint">{signingOrder ? `Signs ${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}` : `Recipient ${i + 1}`}</div>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSigner()}>Add recipient</button>
          {!!contacts.length && (
            <select
              className="input"
              style={{ marginTop: 8 }}
              defaultValue=""
              onChange={(e) => {
                const c = contacts.find((x) => x.id === e.target.value);
                if (c) addSigner(c);
                e.target.value = "";
              }}
            >
              <option value="">Add from contacts…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </select>
          )}

          <label className="label">Carbon copy</label>
          <p className="hint">CC recipients get notified but do not sign.</p>
          {cc.map((c) => (
            <div key={c.id} className="signer-item">
              <input className="input" placeholder="Name" value={c.name} onChange={(e) => updateCc(c.id, { name: e.target.value })} />
              <div style={{ height: 8 }} />
              <input className="input" type="email" placeholder="Email" value={c.email} onChange={(e) => updateCc(c.id, { email: e.target.value })} />
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => removeCc(c.id)}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addCc()}>Add CC</button>

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
