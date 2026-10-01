import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

const FOLDERS = [
  { id: "all", label: "Inbox" },
  { id: "unread", label: "Unread" },
  { id: "request", label: "To sign" },
  { id: "reminder", label: "Reminders" },
  { id: "completed", label: "Completed" },
  { id: "declined", label: "Declined" },
];

function typeMeta(type) {
  if (type === "completed") return { label: "Completed", badge: "badge-completed" };
  if (type === "declined") return { label: "Declined", badge: "badge-declined" };
  if (type === "reminder") return { label: "Reminder", badge: "badge-pending" };
  return { label: "To sign", badge: "badge-sent" };
}

function initials(name, email) {
  const src = String(name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatFull(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Mail() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);
  const [folder, setFolder] = useState("all");
  const [query, setQuery] = useState("");
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

  const counts = useMemo(() => {
    const next = { all: list.length, unread: 0, request: 0, reminder: 0, completed: 0, declined: 0 };
    for (const m of list) {
      if (!m.read) next.unread += 1;
      if (next[m.type] != null) next[m.type] += 1;
    }
    return next;
  }, [list]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((m) => {
      if (folder === "unread" && m.read) return false;
      if (folder !== "all" && folder !== "unread" && m.type !== folder) return false;
      if (!q) return true;
      return [m.subject, m.fromName, m.fromEmail, m.envelopeTitle, m.preview, m.body]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [list, folder, query]);

  const meta = open ? typeMeta(open.type) : null;

  return (
    <div className="mailbox">
      {error && <div className="mailbox-error">{error}</div>}

      <nav className="mailbox-folders" aria-label="Mail folders">
        <div className="mailbox-folders-title">Mailbox</div>
        {FOLDERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`mailbox-folder ${folder === f.id ? "active" : ""}`}
            onClick={() => setFolder(f.id)}
          >
            <span>{f.label}</span>
            <span className="mailbox-count">{counts[f.id] || 0}</span>
          </button>
        ))}
        <p className="mailbox-account">{user.email}</p>
      </nav>

      <section className="mailbox-list">
        <div className="mailbox-list-head">
          <input
            className="mailbox-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search mail"
          />
        </div>
        {!filtered.length ? (
          <div className="mailbox-blank">
            <strong>{list.length ? "No matching messages" : "No messages"}</strong>
            <span>{list.length ? "Try another folder or search." : "New DocySign mail will appear here."}</span>
          </div>
        ) : (
          <div className="mailbox-rows" role="list">
            {filtered.map((m) => {
              const t = typeMeta(m.type);
              const selected = open && open.id === m.id;
              return (
                <button
                  type="button"
                  key={m.id}
                  role="listitem"
                  className={`mailbox-row ${m.read ? "" : "unread"} ${selected ? "selected" : ""}`}
                  onClick={() => openMail(m.id)}
                >
                  {!m.read && <span className="mailbox-dot" aria-hidden="true" />}
                  <span className="mailbox-row-from">{m.fromName}</span>
                  <span className="mailbox-row-main">
                    <span className="mailbox-row-subject">{m.subject}</span>
                    <span className="mailbox-row-preview">{m.preview}</span>
                  </span>
                  <span className="mailbox-row-meta">
                    <span className={`badge ${t.badge}`}>{t.label}</span>
                    <span className="mailbox-row-when">{formatWhen(m.createdAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mailbox-read">
        {!open ? (
          <div className="mailbox-blank mailbox-blank-read">
            <strong>Select a message</strong>
            <span>Choose an email from the list to read it.</span>
          </div>
        ) : (
          <article className="mailbox-message">
            <header className="mailbox-message-bar">
              <span className={`badge ${meta.badge}`}>{meta.label}</span>
              <div className="mailbox-actions">
                {(open.type === "request" || open.type === "reminder") && open.signToken && (
                  <Link className="btn btn-primary btn-sm" to={`/sign/${open.signToken}`}>Review and sign</Link>
                )}
                {open.type === "declined" && open.envelopeId && (
                  <Link className="btn btn-ghost btn-sm" to={`/envelope/${open.envelopeId}`}>Open envelope</Link>
                )}
                {open.type === "completed" && open.envelopeId && (
                  <>
                    <Link className="btn btn-primary btn-sm" to={`/preview/${open.envelopeId}`}>Preview PDF</Link>
                    <Link className="btn btn-ghost btn-sm" to={`/envelope/${open.envelopeId}`}>Envelope</Link>
                  </>
                )}
              </div>
            </header>

            <h1 className="mailbox-subject">{open.subject}</h1>

            <div className="mailbox-headers">
              <span className="mailbox-avatar">{initials(open.fromName, open.fromEmail)}</span>
              <div className="mailbox-headers-grid">
                <div>
                  <span className="mailbox-hlabel">From</span>
                  <span className="mailbox-hvalue">{open.fromName} &lt;{open.fromEmail}&gt;</span>
                </div>
                <div>
                  <span className="mailbox-hlabel">To</span>
                  <span className="mailbox-hvalue">{open.toName || user.name} &lt;{open.to || user.email}&gt;</span>
                </div>
                <div>
                  <span className="mailbox-hlabel">Date</span>
                  <span className="mailbox-hvalue">{formatFull(open.createdAt)}</span>
                </div>
                {open.envelopeTitle && (
                  <div>
                    <span className="mailbox-hlabel">Document</span>
                    <span className="mailbox-hvalue">{open.envelopeTitle}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mailbox-body">
              <p>{open.body}</p>
            </div>
          </article>
        )}
      </section>
    </div>
  );
}
