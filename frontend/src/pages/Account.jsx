import { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Account() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setOk("");
    if (password !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword({ currentPassword, password });
      setCurrentPassword("");
      setPassword("");
      setConfirm("");
      setOk("Password updated. Use it next time you sign in.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Workspace</div>
          <h1 className="serif">Account</h1>
          <p>Your name and email are stored locally. The password is hashed — DocySign never keeps the plaintext.</p>
        </div>
      </div>

      <div className="card settings-card">
        <h3 className="serif" style={{ marginTop: 0 }}>Profile</h3>
        <p><strong>{user.name}</strong></p>
        <p className="meta">{user.email}</p>
        <p className="meta" style={{ marginTop: 8 }}>
          Role: {user.role === "admin" ? "Admin" : "User"}
        </p>
      </div>

      <div className="card settings-card" style={{ marginTop: 16 }}>
        <h3 className="serif" style={{ marginTop: 0 }}>Change password</h3>
        <form onSubmit={submit}>
          <label className="label">Current password</label>
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <label className="label" style={{ marginTop: 12 }}>New password</label>
          <input
            className="input"
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <label className="label" style={{ marginTop: 12 }}>Confirm new password</label>
          <input
            className="input"
            type="password"
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
          {error && <div className="error">{error}</div>}
          {ok && <div className="ok">{ok}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 18 }}>
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
