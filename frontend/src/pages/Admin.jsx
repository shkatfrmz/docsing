import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Settings from "./Settings.jsx";

function badgeClass(status) {
  if (status === "completed") return "badge badge-completed";
  if (status === "declined" || status === "voided") return "badge badge-declined";
  if (status === "expired") return "badge badge-expired";
  if (status === "sent") return "badge badge-sent";
  if (status === "admin") return "badge badge-sent";
  return "badge badge-draft";
}

const EMPTY = {
  name: "",
  email: "",
  password: "",
  role: "user",
};

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [envelopes, setEnvelopes] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [st, us, envs] = await Promise.all([
      api.adminStats(),
      api.adminUsers(),
      api.adminEnvelopes(),
    ]);
    setStats(st);
    setUsers(us);
    setEnvelopes(envs);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function createUser(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api.adminCreateUser(form);
      setForm(EMPTY);
      setOk("Account created.");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setRole(id, role) {
    setError("");
    setOk("");
    try {
      await api.adminSetRole(id, role);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetPassword(id, name) {
    const password = window.prompt(`New password for ${name} (min 6 characters)`);
    if (!password) return;
    setError("");
    setOk("");
    try {
      await api.adminResetPassword(id, password);
      setOk(`Password reset for ${name}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeUser(id, name) {
    if (!window.confirm(`Delete ${name}? They will be signed out immediately.`)) return;
    setError("");
    setOk("");
    try {
      await api.adminDeleteUser(id);
      setOk("User deleted.");
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  const cards = stats
    ? [
        { label: "Users", value: stats.users, hint: `${stats.admins} admin${stats.admins === 1 ? "" : "s"}` },
        { label: "PDFs signed", value: stats.pdfsSigned, hint: "Individual signatures" },
        { label: "PDFs delivered", value: stats.pdfsDelivered, hint: "Completed envelopes" },
        { label: "Waiting", value: stats.waiting, hint: "Out for signature" },
        { label: "Declined", value: stats.declined, hint: "Signer declined" },
        { label: "Voided / expired", value: (stats.voided || 0) + (stats.expired || 0), hint: `${stats.voided || 0} voided · ${stats.expired || 0} expired` },
        { label: "Mail sent", value: stats.mailSent, hint: stats.smtpReady ? "SMTP ready" : "SMTP not configured" },
      ]
    : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Control plane</div>
          <h1 className="serif">Admin</h1>
          <p>Manage accounts, watch signing volume, and configure product-wide mail.</p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 24 }}>
        {[
          ["overview", "Overview"],
          ["users", "Users"],
          ["envelopes", "Envelopes"],
          ["mail", "Mail settings"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {ok && <div className="ok">{ok}</div>}

      {tab === "overview" && (
        <>
          <div className="admin-stats">
            {cards.map((c) => (
              <div className="admin-stat" key={c.label}>
                <b>{c.value}</b>
                <span>{c.label}</span>
                <em>{c.hint}</em>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 20 }}>
            <h3 className="serif" style={{ marginTop: 0 }}>Product snapshot</h3>
            <p className="meta">
              {stats ? `${stats.envelopes} envelopes · ${stats.drafts} drafts · ${stats.sent} in flight · ${stats.completed} completed · ${stats.voided || 0} voided · ${stats.expired || 0} expired` : "Loading…"}
            </p>
          </div>
        </>
      )}

      {tab === "users" && (
        <div className="admin-split">
          <div className="card">
            <h3 className="serif" style={{ marginTop: 0 }}>Create user</h3>
            <form onSubmit={createUser}>
              <label className="label">Full name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <label className="label" style={{ marginTop: 12 }}>Email</label>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
              <label className="label" style={{ marginTop: 12 }}>Password</label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                minLength={6}
                required
              />
              <label className="label" style={{ marginTop: 12 }}>Role</label>
              <select
                className="input"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 18 }}>
                {busy ? "Creating…" : "Create account"}
              </button>
            </form>
          </div>
          <div className="card" style={{ overflowX: "auto" }}>
            <h3 className="serif" style={{ marginTop: 0 }}>Accounts</h3>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      {u.id === user.id ? <span className="meta"> (you)</span> : null}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className={badgeClass(u.role)}>{u.role}</span>
                    </td>
                    <td className="admin-row-actions">
                      {u.role === "admin" ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRole(u.id, "user")}>
                          Make user
                        </button>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRole(u.id, "admin")}>
                          Make admin
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => resetPassword(u.id, u.name)}>
                        Reset password
                      </button>
                      {u.id !== user.id && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeUser(u.id, u.name)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "envelopes" && (
        <div className="card" style={{ overflowX: "auto" }}>
          <h3 className="serif" style={{ marginTop: 0 }}>All envelopes</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Signers</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {envelopes.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.title}</strong>
                    <div className="meta">{e.fileName}</div>
                  </td>
                  <td><span className={badgeClass(e.status)}>{e.status}</span></td>
                  <td>
                    {e.signers.map((s) => (
                      <div key={s.email} className="meta">
                        {s.name || s.email} · {s.status}
                      </div>
                    ))}
                  </td>
                  <td className="meta">{new Date(e.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {!envelopes.length && (
                <tr>
                  <td colSpan={4} className="meta">No envelopes yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "mail" && (
        <>
          <p className="meta" style={{ marginBottom: 16 }}>
            One mailbox for the product. Regular users cannot change this.
          </p>
          <Settings embedded />
        </>
      )}
    </div>
  );
}
