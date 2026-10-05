import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import SignaturePad from "../components/SignaturePad.jsx";

export default function Account() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [saved, setSaved] = useState({ signature: "", initials: "" });
  const [draw, setDraw] = useState("");
  const [drawKind, setDrawKind] = useState("signature");

  useEffect(() => {
    api.signature().then(setSaved).catch(() => {});
  }, []);

  async function saveName(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      const next = await api.updateProfile({ name });
      setUser(next);
      setOk("Name updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveMark(kind) {
    if (!draw) {
      setError("Draw a mark first");
      return;
    }
    setBusy(true);
    setError("");
    setOk("");
    try {
      const patch = kind === "initials" ? { initials: draw } : { signature: draw };
      const next = await api.updateProfile(patch);
      setUser(next);
      setSaved(await api.signature());
      setDraw("");
      setOk(kind === "initials" ? "Initials saved." : "Signature saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearMark(kind) {
    setBusy(true);
    setError("");
    try {
      const patch = kind === "initials" ? { initials: "" } : { signature: "" };
      const next = await api.updateProfile(patch);
      setUser(next);
      setSaved(await api.signature());
      setOk("Cleared.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

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
          <p>Update your name, save a signature for reuse, and change your password.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card settings-card">
        <h3 className="serif" style={{ marginTop: 0 }}>Profile</h3>
        <form onSubmit={saveName}>
          <label className="label">Full name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          <p className="meta" style={{ marginTop: 10 }}>{user.email}</p>
          <p className="meta">Role: {user.role === "admin" ? "Admin" : "User"}</p>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 14 }}>
            Save name
          </button>
        </form>
      </div>

      <div className="card settings-card" style={{ marginTop: 16 }}>
        <h3 className="serif" style={{ marginTop: 0 }}>Saved signature</h3>
        <p className="meta">Adopt this mark on any envelope instead of drawing each time.</p>
        <div className="row" style={{ margin: "12px 0" }}>
          <button type="button" className={`btn btn-sm ${drawKind === "signature" ? "btn-primary" : "btn-ghost"}`} onClick={() => setDrawKind("signature")}>Signature</button>
          <button type="button" className={`btn btn-sm ${drawKind === "initials" ? "btn-primary" : "btn-ghost"}`} onClick={() => setDrawKind("initials")}>Initials</button>
        </div>
        {(drawKind === "signature" ? saved.signature : saved.initials) && (
          <img
            src={drawKind === "signature" ? saved.signature : saved.initials}
            alt=""
            style={{ width: "100%", maxHeight: 100, objectFit: "contain", background: "#fff", borderRadius: 8, marginBottom: 12 }}
          />
        )}
        <SignaturePad onChange={setDraw} />
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-gold" disabled={busy} onClick={() => saveMark(drawKind)}>
            Save {drawKind}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => clearMark(drawKind)}>
            Clear saved
          </button>
        </div>
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
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 18 }}>
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
