import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Prepare from "./pages/Prepare.jsx";
import Envelope from "./pages/Envelope.jsx";
import Sign from "./pages/Sign.jsx";
import Mail from "./pages/Mail.jsx";
import Preview from "./pages/Preview.jsx";

function Topbar() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuth();
  if (pathname.startsWith("/sign")) return null;
  const home = pathname === "/";
  return (
    <header className="topbar">
      <Link to={user ? "/app" : "/"} className="brand">
        <span className="brand-mark" />
        DocySign
      </Link>
      {home && !user && (
        <nav className="nav-center">
          <a className="nav-link" href="#product">Product</a>
          <a className="nav-link" href="#product">Solutions</a>
          <a className="nav-link" href="#customers">Customers</a>
          <a className="nav-link" href="#pricing">Pricing</a>
        </nav>
      )}
      <nav className="nav-actions">
        {user ? (
          <>
            <Link to="/app" className="nav-link">Workspace</Link>
            <Link to="/mail" className="nav-link">Mail</Link>
            <span className="meta">{user.name}</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                await logout();
                nav("/");
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="nav-link">Sign in</Link>
            <Link to="/signup" className="btn btn-primary">Try free</Link>
          </>
        )}
      </nav>
    </header>
  );
}

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="page">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}

function GuestOnly({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="page">Loading…</div>;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <Topbar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
        <Route path="/app" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/mail" element={<RequireAuth><Mail /></RequireAuth>} />
        <Route path="/prepare/:id" element={<RequireAuth><Prepare /></RequireAuth>} />
        <Route path="/envelope/:id" element={<RequireAuth><Envelope /></RequireAuth>} />
        <Route path="/preview/:id" element={<RequireAuth><Preview /></RequireAuth>} />
        <Route path="/sign/:token" element={<Sign />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
