import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, downloadUrl } from "../api.js";
import { useAuth } from "../auth.jsx";

function badgeClass(status) {
  if (status === "completed") return "badge badge-completed";
  if (status === "declined") return "badge badge-declined";
  if (status === "sent") return "badge badge-sent";
  return "badge badge-draft";
}

function EnvelopeCard({ env, userEmail }) {
  const mine = env.signers.find((s) => s.email.toLowerCase() === userEmail && s.token && s.status === "pending");
  const signedByMe = env.signers.find((s) => s.email.toLowerCase() === userEmail && s.status === "signed");
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className={badgeClass(env.status)}>{env.status}</span>
        <span className="meta">{new Date(env.updatedAt).toLocaleDateString()}</span>
      </div>
      <h3>{env.title}</h3>
      <p className="meta">{env.fileName}</p>
      <p className="meta" style={{ marginTop: 8 }}>
        {env.signers.length ? env.signers.map((s) => s.name || s.email).join(", ") : "No recipients yet"}
      </p>
      {signedByMe && signedByMe.signedAt && (
        <p className="meta" style={{ marginTop: 6 }}>You signed {new Date(signedByMe.signedAt).toLocaleString()}</p>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <Link
          className="btn btn-ghost btn-sm"
          to={env.status === "draft" ? `/prepare/${env.id}` : `/envelope/${env.id}`}
        >
          {env.status === "draft" ? "Continue editing" : "Open"}
        </Link>
        {mine && (
          <Link className="btn btn-gold btn-sm" to={`/sign/${mine.token}`}>
            Sign now
          </Link>
        )}
        {env.status === "completed" && (
          <>
            <Link className="btn btn-ghost btn-sm" to={`/preview/${env.id}`}>Preview</Link>
            <a className="btn btn-primary btn-sm" href={downloadUrl(env.id)}>Download</a>
          </>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [tab, setTab] = useState("sent");
  const [list, setList] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [library, setLibrary] = useState([]);
  const [stats, setStats] = useState({ signedCount: 0, pendingCount: 0, completedCount: 0, sentCount: 0 });
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function refresh() {
    try {
      const [mine, incoming, done, st, mail] = await Promise.all([
        api.list(),
        api.inbox(),
        api.library(),
        api.stats(),
        api.mail(),
      ]);
      setList(mine);
      setInbox(incoming);
      setLibrary(done);
      setStats(st);
      setUnread(mail.filter((m) => !m.read).length);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleFile(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const env = await api.create(file, file.name.replace(/\.pdf$/i, ""));
      nav(`/prepare/${env.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function useSample() {
    setBusy(true);
    setError("");
    try {
      const env = await api.sample();
      nav(`/prepare/${env.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const items = tab === "inbox" ? inbox : tab === "completed" ? library : list;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Workspace</div>
          <h1 className="serif">Hi, {user.name.split(" ")[0]}</h1>
          <p>You have signed {stats.signedCount} document{stats.signedCount === 1 ? "" : "s"}. Final copies land here for everyone on the envelope.</p>
        </div>
        <Link to="/mail" className="btn btn-ghost">
          Mail{unread ? ` (${unread})` : ""}
        </Link>
      </div>

      <div className="stats" style={{ marginTop: 0, marginBottom: 32 }}>
        <div className="stat"><b>{stats.signedCount}</b><span>PDFs you signed</span></div>
        <div className="stat"><b>{stats.pendingCount}</b><span>Waiting on you</span></div>
        <div className="stat"><b>{stats.completedCount}</b><span>Completed in workspace</span></div>
        <div className="stat"><b>{unread}</b><span>Unread emails</span></div>
      </div>

      <div
        className={`dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        <h2 className="serif" style={{ margin: "0 0 8px" }}>
          {busy ? "Working…" : "Start a new envelope"}
        </h2>
        <p className="hint">PDF only. Max 20 MB. Recipients get an email with a signing link.</p>
        <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => fileRef.current.click()}>
            Upload PDF
          </button>
          <button type="button" className="btn btn-gold" disabled={busy} onClick={useSample}>
            Use sample NDA
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>
      {error && <div className="error">{error}</div>}

      <div className="tabs">
        <button type="button" className={`tab ${tab === "sent" ? "active" : ""}`} onClick={() => setTab("sent")}>
          Sent by me ({list.length})
        </button>
        <button type="button" className={`tab ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>
          To sign ({inbox.length})
        </button>
        <button type="button" className={`tab ${tab === "completed" ? "active" : ""}`} onClick={() => setTab("completed")}>
          Completed ({library.length})
        </button>
      </div>

      {!items.length ? (
        <div className="empty">
          <h3 className="serif">
            {tab === "inbox" ? "Nothing waiting on you" : tab === "completed" ? "No completed documents yet" : "No envelopes yet"}
          </h3>
          <p className="meta">
            {tab === "inbox"
              ? "When someone emails you a document to sign, it appears here and in Mail."
              : tab === "completed"
                ? "When every party signs, the final PDF is added to every participant’s workspace."
                : "Upload a PDF or use the sample NDA to create your first envelope."}
          </p>
        </div>
      ) : (
        <div className="grid-cards">
          {items.map((env) => <EnvelopeCard key={env.id} env={env} userEmail={user.email} />)}
        </div>
      )}
    </div>
  );
}
