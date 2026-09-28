import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function Mail() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setList(await api.mail());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function openMail(id) {
    try {
      const msg = await api.mailOne(id);
      setOpen(msg);
      setList((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)));
    } catch (e) {
      setError(e.message);
    }
  }

  const unread = list.filter((m) => !m.read).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Mailbox</div>
          <h1 className="serif">Email</h1>
          <p>{unread ? `${unread} unread` : "Signing requests and completed documents land here."}</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="layout-2">
        <div>
          {!list.length ? (
            <div className="empty">
              <h3 className="serif">No mail yet</h3>
              <p className="meta">When someone sends you a document, the email appears here.</p>
            </div>
          ) : (
            list.map((m) => (
              <button
                type="button"
                key={m.id}
                className="card"
                style={{
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 10,
                  background: m.read ? "var(--canvas)" : "var(--soft)",
                  cursor: "pointer",
                }}
                onClick={() => openMail(m.id)}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className={`badge ${m.type === "completed" ? "badge-completed" : "badge-sent"}`}>
                    {m.type === "completed" ? "Completed" : "To sign"}
                  </span>
                  <span className="meta">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <h3 style={{ marginTop: 8 }}>{m.subject}</h3>
                <p className="meta">From {m.fromName} · {m.preview}</p>
              </button>
            ))
          )}
        </div>
        <aside className="card">
          {!open ? (
            <p className="meta">Select a message to read it.</p>
          ) : (
            <>
              <div className="kicker">{open.type === "completed" ? "Completed document" : "Signature requested"}</div>
              <h3 className="serif" style={{ fontSize: 28, margin: "8px 0" }}>{open.envelopeTitle}</h3>
              <p className="meta">From {open.fromName} ({open.fromEmail})</p>
              <p style={{ marginTop: 16 }}>{open.body}</p>
              <div className="row" style={{ marginTop: 20 }}>
                {open.type === "request" && open.signToken && (
                  <Link className="btn btn-primary" to={`/sign/${open.signToken}`}>Review and sign</Link>
                )}
                {open.type === "completed" && open.envelopeId && (
                  <>
                    <Link className="btn btn-primary" to={`/preview/${open.envelopeId}`}>Preview final PDF</Link>
                    <Link className="btn btn-ghost" to={`/envelope/${open.envelopeId}`}>Open in workspace</Link>
                  </>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
