import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { api, safeNext } from "../api.js";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const next = params.get("next") || loc.state?.from || "/app";
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  // A failed Microsoft sign-in comes back here with the reason.
  const [error, setError] = useState(params.get("error") || "");
  const [busy, setBusy] = useState(false);
  // Which ways of signing in this installation offers.
  const [options, setOptions] = useState({ localSignup: true, ldap: false, entra: false });

  useEffect(() => {
    api.authOptions().then(setOptions).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login({ email, password });
      nav(safeNext(next), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const microsoftHref = `/api/auth/entra/start?next=${encodeURIComponent(safeNext(next))}`;

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="kicker">Welcome back</div>
        <h1 className="serif">Sign in to DocySign</h1>
        <p className="meta">
          {options.ldap
            ? "Use your company username and password, or the email you signed up with."
            : "Use the email you signed up with to open your workspace and inbox."}
        </p>

        {options.entra && (
          <>
            <a className="btn btn-ghost" href={microsoftHref} style={{ width: "100%", marginTop: 8, justifyContent: "center", textDecoration: "none" }}>
              Sign in with Microsoft
            </a>
            <p className="meta" style={{ textAlign: "center", margin: "14px 0 0" }}>or</p>
          </>
        )}

        <label className="label" htmlFor="login-id">{options.ldap ? "Username or email" : "Work email"}</label>
        <input
          id="login-id"
          className="input"
          type={options.ldap ? "text" : "email"}
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label className="label" htmlFor="login-password">Password</label>
        <input
          id="login-password"
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 18 }}>
          {busy ? "Signing in…" : "Log in"}
        </button>
        {options.localSignup && (
          <p className="meta" style={{ marginTop: 16 }}>
            New here? <Link to={`/signup${email ? `?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
          </p>
        )}
      </form>
    </div>
  );
}
