import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const next = params.get("next") || loc.state?.from || "/app";
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login({ email, password });
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
        <div className="kicker">Welcome back</div>
        <h1 className="serif">Sign in to DocySign</h1>
        <p className="meta">Use the email you signed up with to open your workspace and inbox.</p>
        <label className="label">Work email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="label">Password</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 18 }}>
          {busy ? "Signing in…" : "Log in"}
        </button>
        <p className="meta" style={{ marginTop: 16 }}>
          New here? <Link to={`/signup${email ? `?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
        </p>
      </form>
    </div>
  );
}
