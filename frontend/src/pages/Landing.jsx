import { Link } from "react-router-dom";
import { useAuth } from "../auth.jsx";

function ClayMountains({ peach = "#ffb084", ochre = "#e8b94a", lavender = "#b8a4ed" }) {
  return (
    <svg className="clay-scene" viewBox="0 0 480 280" fill="none" aria-hidden="true">
      <ellipse cx="240" cy="250" rx="200" ry="18" fill="#ebe6d6" />
      <path d="M40 250 L140 90 L240 250 Z" fill={peach} />
      <path d="M160 250 L280 50 L400 250 Z" fill={ochre} />
      <path d="M280 250 L380 110 L470 250 Z" fill={lavender} />
      <circle cx="90" cy="70" r="28" fill="#ff6b5a" />
      <circle cx="78" cy="62" r="8" fill="#ffb084" />
      <ellipse cx="120" cy="210" rx="22" ry="28" fill="#1a3a3a" />
      <circle cx="120" cy="178" r="18" fill="#ffb084" />
      <circle cx="114" cy="174" r="3" fill="#0a0a0a" />
      <circle cx="126" cy="174" r="3" fill="#0a0a0a" />
      <ellipse cx="360" cy="214" rx="20" ry="26" fill="#ff4d8b" />
      <circle cx="360" cy="184" r="16" fill="#b8a4ed" />
    </svg>
  );
}

export default function Landing() {
  const { user } = useAuth();
  return (
    <>
      <section className="hero">
        <div>
          <div className="kicker">Electronic signatures</div>
          <h1 className="serif">Get any PDF signed without the chase.</h1>
          <p>
            DocySign helps teams send contracts, collect signatures from teammates
            and managers, and download a completed file with a full audit trail.
          </p>
          <div className="hero-cta">
            <Link to={user ? "/app" : "/signup"} className="btn btn-primary">
              {user ? "Open workspace" : "Try free"}
            </Link>
            {!user && <Link to="/login" className="btn btn-ghost">Sign in</Link>}
          </div>
          <div className="stats">
            <div className="stat"><b>Inbox</b><span>Requests land by email</span></div>
            <div className="stat"><b>Routing</b><span>Signers and approvers</span></div>
            <div className="stat"><b>Archive</b><span>Stamped PDF download</span></div>
          </div>
        </div>
        <div className="hero-illustration-card">
          <ClayMountains />
        </div>
      </section>

      <section className="features" id="product">
        <div className="feature feature-pink">
          <h3>Prepare any PDF</h3>
          <p>Drop a contract or start from a sample NDA. Place signature, name, and date fields exactly where they belong.</p>
          <div className="mock-chip">Signature field</div>
        </div>
        <div className="feature feature-teal">
          <h3>Route to people</h3>
          <p>Add teammates, managers, or outside signers. Each person gets a private link and only fills their fields.</p>
          <div className="mock-chip">Needs to sign</div>
        </div>
        <div className="feature feature-lavender">
          <h3>Download the original</h3>
          <p>When everyone signs, DocySign stamps the PDF and attaches a certificate of completion you can archive.</p>
          <div className="mock-chip">Completed</div>
        </div>
      </section>

      <section className="testimonial-row" id="customers">
        <div className="testimonial-card">
          <p>“We used to chase wet-ink signatures across three time zones. DocySign turned that into one inbox.”</p>
          <div className="who">
            <div className="avatar">AR</div>
            <div>
              <strong style={{ color: "var(--ink)" }}>Alex Rivera</strong>
              <div className="meta">Ops lead</div>
            </div>
          </div>
        </div>
        <div className="testimonial-card">
          <p>“Managers sign from their phone. Legal still gets a certified PDF. That is the whole product.”</p>
          <div className="who">
            <div className="avatar" style={{ background: "var(--peach)" }}>JH</div>
            <div>
              <strong style={{ color: "var(--ink)" }}>Jordan Hale</strong>
              <div className="meta">People partner</div>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band" id="pricing">
        <div>
          <h2 className="serif">Send the next agreement today.</h2>
          <p>Create an account, upload a PDF, and invite your first signer in a few minutes.</p>
          <div style={{ marginTop: 24 }}>
            <Link to={user ? "/app" : "/signup"} className="btn btn-primary">
              {user ? "Go to workspace" : "Try free"}
            </Link>
          </div>
        </div>
        <ClayMountains peach="#a4d4c5" ochre="#ffb084" lavender="#ff4d8b" />
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <div>
            <div className="brand" style={{ marginBottom: 12 }}>
              <span className="brand-mark" />
              DocySign
            </div>
            <p>Electronic signatures for teams that still need a real PDF at the end.</p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#product">Prepare</a>
            <a href="#product">Inbox</a>
            <a href="#product">Audit trail</a>
          </div>
          <div>
            <h4>Solutions</h4>
            <a href="#product">HR offers</a>
            <a href="#product">Vendor NDAs</a>
            <a href="#product">Approvals</a>
          </div>
          <div>
            <h4>Resources</h4>
            <Link to="/signup">Create account</Link>
            <Link to="/login">Sign in</Link>
          </div>
          <div>
            <h4>Company</h4>
            <a href="#customers">Customers</a>
            <a href="#pricing">Pricing</a>
          </div>
        </div>
        <svg className="footer-horizon" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 90 L0 70 L180 20 L360 70 L540 10 L720 70 L900 30 L1080 70 L1260 18 L1440 70 L1440 90 Z" fill="#ffb084" />
          <path d="M0 90 L0 80 L240 40 L480 80 L720 28 L960 80 L1200 48 L1440 80 L1440 90 Z" fill="#e8b94a" />
        </svg>
      </footer>
    </>
  );
}
