import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Contacts() {
  const [list, setList] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setList(await api.contacts());
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api.addContact({ name, email, company });
      setName("");
      setEmail("");
      setCompany("");
      setOk("Contact saved.");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id, label) {
    if (!window.confirm(`Remove ${label}?`)) return;
    await api.deleteContact(id);
    await refresh();
  }

  const filtered = list.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q)
      || c.email.toLowerCase().includes(q)
      || (c.company || "").toLowerCase().includes(q);
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Address book</div>
          <h1 className="serif">Contacts</h1>
          <p>Save people you send envelopes to. They appear as quick-add options when you prepare a document.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="admin-split">
        <form className="card" onSubmit={add}>
          <h3 className="serif" style={{ marginTop: 0 }}>Add contact</h3>
          <label className="label">Full name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          <label className="label" style={{ marginTop: 12 }}>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label className="label" style={{ marginTop: 12 }}>Company (optional)</label>
          <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 18 }}>
            {busy ? "Saving…" : "Save contact"}
          </button>
        </form>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3 className="serif" style={{ margin: 0 }}>{filtered.length} people</h3>
            <input
              className="input"
              style={{ maxWidth: 220 }}
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {!filtered.length ? (
            <p className="meta">No contacts yet. Add teammates you send NDAs and offers to.</p>
          ) : (
            filtered.map((c) => (
              <div key={c.id} className="signer-item">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{c.name}</strong>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(c.id, c.name)}>
                    Remove
                  </button>
                </div>
                <div className="meta">{c.email}{c.company ? ` · ${c.company}` : ""}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
