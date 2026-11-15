import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { api, safeNext } from "../api.js";

/** Where the browser lands after "Sign in with Microsoft". */
export default function AuthCallback() {
  const { adopt } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    // The code works once, so guard against the effect running twice.
    if (started.current) return;
    started.current = true;
    api.exchange(params.get("code"))
      .then((res) => {
        adopt(res);
        nav(safeNext(params.get("next")), { replace: true });
      })
      .catch((e) => setError(e.message));
  }, [adopt, nav, params]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        {error ? (
          <>
            <h1 className="serif">Sign-in did not finish</h1>
            <div className="error" role="alert">{error}</div>
            <p className="meta" style={{ marginTop: 16 }}><Link to="/login">Back to sign in</Link></p>
          </>
        ) : (
          <p className="meta">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
