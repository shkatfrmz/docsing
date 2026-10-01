import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/app";
  const invited = useMemo(() => ({
    name: params.get("name") || "",
    email: params.get("email") || "",
  }), [params]);
  const [name, setName] = useState(invited.name);
  const [email, setEmail] = useState(invited.email);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signup({ name, email, password });
      nav(next.startsWith("/") ? next : "/app", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="kicker">Get started</div>
        <h1 className="serif">Try DocySign free</h1>
        <p className="meta">
          {invited.email
            ? `You were invited as ${invited.email}. Create an account with that address to keep this document in your workspace.`
            : "Sign up to send documents, collect signatures, and download completed PDFs."}
        </p>
        <label className="label">Full name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        <label className="label">Work email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={!!invited.email} />
        <label className="label">Password</label>
        <input className="input" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="hint">At least 6 characters.</div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 18 }}>
          {busy ? "Creating account…" : "Try free"}
        </button>
        <p className="meta" style={{ marginTop: 16 }}>
          Already have an account? <Link to={`/login?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`}>Log in</Link>
        </p>
      </form>
    </div>
  );
}
