import { useEffect, useState } from "react";
import { api } from "../api.js";

const EMPTY = {
  localSignup: true,
  ldap: {
    enabled: false,
    url: "",
    bindDn: "",
    bindPassword: "",
    baseDn: "",
    userFilter: "",
    allowedGroup: "",
    adminGroup: "",
    startTls: false,
    allowSelfSigned: false,
  },
  entra: { enabled: false, tenantId: "", clientId: "", clientSecret: "", allowedGroup: "", adminGroup: "" },
};

/** Admin settings for signing in with Active Directory and Microsoft Entra ID. */
export default function Directory() {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState({ ldapReady: false, entraReady: false, hasBind: false, hasSecret: false, filter: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [test, setTest] = useState({ username: "", password: "" });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState("");

  function load(data) {
    setForm({
      localSignup: data.localSignup !== false,
      ldap: { ...EMPTY.ldap, ...data.ldap, bindPassword: "" },
      entra: { ...EMPTY.entra, ...data.entra, clientSecret: "" },
    });
    setStatus({
      ldapReady: !!data.ldap.ready,
      entraReady: !!data.entra.ready,
      hasBind: !!data.ldap.hasBindPassword,
      hasSecret: !!data.entra.hasClientSecret,
      filter: data.defaultUserFilter || "",
    });
  }

  useEffect(() => {
    api.authSettings().then(load).catch((e) => setError(e.message));
  }, []);

  const setLdap = (key, value) => setForm((f) => ({ ...f, ldap: { ...f.ldap, [key]: value } }));
  const setEntra = (key, value) => setForm((f) => ({ ...f, entra: { ...f.entra, [key]: value } }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      load(await api.saveAuthSettings(form));
      setOk("Sign-in settings saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestError("");
    setTestResult(null);
    try {
      setTestResult(await api.testDirectory(test.username, test.password));
      setTest((t) => ({ ...t, password: "" }));
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTesting(false);
    }
  }

  const redirectUri = `${window.location.origin}/api/auth/entra/callback`;
  const badge = (ready, on) => (
    <span className={`badge ${ready ? "badge-completed" : "badge-draft"}`}>
      {ready ? "On" : on ? "Incomplete" : "Off"}
    </span>
  );

  return (
    <>
    <form onSubmit={save}>
      <p className="meta" style={{ marginBottom: 16 }}>
        Let people sign in with their company account. An account is created for them the first time they sign in.
        People who receive a signing link still sign without an account.
      </p>

      <div className="card settings-card">
        <h3 className="serif" style={{ marginTop: 0 }}>DocySign accounts</h3>
        <label className="check-label">
          <input
            type="checkbox"
            checked={form.localSignup}
            onChange={(e) => setForm((f) => ({ ...f, localSignup: e.target.checked }))}
          />
          Anyone can sign up with an email and password
        </label>
        <p className="hint" style={{ marginTop: 8 }}>
          Turn this off to allow company accounts only. Existing DocySign accounts, including yours, keep working, so
          you can always get back in if the directory is unreachable.
        </p>
      </div>

      <div className="card settings-card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="serif" style={{ margin: 0 }}>Active Directory (LDAP)</h3>
          {badge(status.ldapReady, form.ldap.enabled)}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          People type their domain username and password on the DocySign sign-in page, and DocySign checks them with
          your domain controller.
        </p>
        <label className="check-label" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={form.ldap.enabled} onChange={(e) => setLdap("enabled", e.target.checked)} />
          Allow sign-in with Active Directory
        </label>

        <label className="label" htmlFor="ldap-url" style={{ marginTop: 12 }}>Directory server</label>
        <input
          id="ldap-url"
          className="input"
          value={form.ldap.url}
          onChange={(e) => setLdap("url", e.target.value)}
          placeholder="ldaps://dc01.corp.example.com:636"
          required={form.ldap.enabled}
        />
        <p className="hint" style={{ marginTop: 6 }}>
          Use ldaps:// so passwords are encrypted on the network. With ldap:// turn on StartTLS below.
        </p>
        <label className="check-label" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={form.ldap.startTls} onChange={(e) => setLdap("startTls", e.target.checked)} />
          Upgrade ldap:// connections with StartTLS
        </label>
        <label className="check-label" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={form.ldap.allowSelfSigned}
            onChange={(e) => setLdap("allowSelfSigned", e.target.checked)}
          />
          Accept a certificate from your own certificate authority or a self-signed one
        </label>

        <label className="label" htmlFor="ldap-base" style={{ marginTop: 12 }}>Search base</label>
        <input
          id="ldap-base"
          className="input"
          value={form.ldap.baseDn}
          onChange={(e) => setLdap("baseDn", e.target.value)}
          placeholder="DC=corp,DC=example,DC=com"
          required={form.ldap.enabled}
        />

        <label className="label" htmlFor="ldap-bind" style={{ marginTop: 12 }}>Service account</label>
        <input
          id="ldap-bind"
          className="input"
          value={form.ldap.bindDn}
          onChange={(e) => setLdap("bindDn", e.target.value)}
          placeholder="svc-docysign@corp.example.com or CN=svc-docysign,OU=Service Accounts,DC=corp,DC=example,DC=com"
        />
        <p className="hint" style={{ marginTop: 6 }}>
          A read-only account used to look people up. Leave blank to look people up as themselves; they must then
          sign in with their full name@domain.
        </p>

        <label className="label" htmlFor="ldap-pass" style={{ marginTop: 12 }}>
          Service account password {status.hasBind ? "(saved — leave blank to keep)" : ""}
        </label>
        <input
          id="ldap-pass"
          className="input"
          type="password"
          autoComplete="new-password"
          value={form.ldap.bindPassword}
          onChange={(e) => setLdap("bindPassword", e.target.value)}
          placeholder={status.hasBind ? "••••••••" : ""}
        />

        <label className="label" htmlFor="ldap-allowed" style={{ marginTop: 12 }}>Only allow members of this group (optional)</label>
        <input
          id="ldap-allowed"
          className="input"
          value={form.ldap.allowedGroup}
          onChange={(e) => setLdap("allowedGroup", e.target.value)}
          placeholder="CN=DocySign Users,OU=Groups,DC=corp,DC=example,DC=com"
        />

        <label className="label" htmlFor="ldap-admin" style={{ marginTop: 12 }}>Members of this group are DocySign admins (optional)</label>
        <input
          id="ldap-admin"
          className="input"
          value={form.ldap.adminGroup}
          onChange={(e) => setLdap("adminGroup", e.target.value)}
          placeholder="CN=DocySign Admins,OU=Groups,DC=corp,DC=example,DC=com"
        />
        <p className="hint" style={{ marginTop: 6 }}>
          Groups are given by their full distinguished name. Membership through nested groups counts. When an admin
          group is set, the admin role follows it at every sign-in.
        </p>

        <label className="label" htmlFor="ldap-filter" style={{ marginTop: 12 }}>How to find a person (advanced)</label>
        <input
          id="ldap-filter"
          className="input"
          value={form.ldap.userFilter}
          onChange={(e) => setLdap("userFilter", e.target.value)}
          placeholder={status.filter}
        />
        <p className="hint" style={{ marginTop: 6 }}>
          Leave blank to match the username, name@domain or email. {"{{username}}"} is replaced with what the person typed.
        </p>
      </div>

      <div className="card settings-card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="serif" style={{ margin: 0 }}>Microsoft Entra ID</h3>
          {badge(status.entraReady, form.entra.enabled)}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Adds a "Sign in with Microsoft" button. People sign in on Microsoft's page, with your organisation's
          multi-factor rules. In Entra, register an app (Web platform) with this redirect address:
        </p>
        <code style={{ display: "block", wordBreak: "break-all", fontSize: 13, margin: "6px 0 0" }}>{redirectUri}</code>
        <p className="hint" style={{ marginTop: 6 }}>
          Open DocySign at its final address before copying this. Microsoft only allows http:// for localhost.
        </p>
        <label className="check-label" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={form.entra.enabled} onChange={(e) => setEntra("enabled", e.target.checked)} />
          Allow sign-in with Microsoft
        </label>

        <label className="label" htmlFor="entra-tenant" style={{ marginTop: 12 }}>Directory (tenant) ID</label>
        <input
          id="entra-tenant"
          className="input"
          value={form.entra.tenantId}
          onChange={(e) => setEntra("tenantId", e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          required={form.entra.enabled}
        />
        <label className="label" htmlFor="entra-client" style={{ marginTop: 12 }}>Application (client) ID</label>
        <input
          id="entra-client"
          className="input"
          value={form.entra.clientId}
          onChange={(e) => setEntra("clientId", e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          required={form.entra.enabled}
        />
        <label className="label" htmlFor="entra-secret" style={{ marginTop: 12 }}>
          Client secret {status.hasSecret ? "(saved — leave blank to keep)" : ""}
        </label>
        <input
          id="entra-secret"
          className="input"
          type="password"
          autoComplete="new-password"
          value={form.entra.clientSecret}
          onChange={(e) => setEntra("clientSecret", e.target.value)}
          placeholder={status.hasSecret ? "••••••••" : "The secret's Value, not its ID"}
        />

        <label className="label" htmlFor="entra-allowed" style={{ marginTop: 12 }}>Only allow members of this group (optional)</label>
        <input
          id="entra-allowed"
          className="input"
          value={form.entra.allowedGroup}
          onChange={(e) => setEntra("allowedGroup", e.target.value)}
          placeholder="Group object ID"
        />
        <label className="label" htmlFor="entra-admin" style={{ marginTop: 12 }}>Members of this group are DocySign admins (optional)</label>
        <input
          id="entra-admin"
          className="input"
          value={form.entra.adminGroup}
          onChange={(e) => setEntra("adminGroup", e.target.value)}
          placeholder="Group object ID"
        />
        <p className="hint" style={{ marginTop: 6 }}>
          Groups are given by object ID. To use them, add the groups claim to the ID token under the app
          registration's token configuration. You can also limit who may sign in from Entra itself, with
          "Assignment required" on the enterprise application.
        </p>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {ok && <div className="ok">{ok}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 18 }}>
        {busy ? "Saving…" : "Save sign-in settings"}
      </button>
    </form>

      <div className="card settings-card" style={{ marginTop: 24 }}>
        <h3 className="serif" style={{ marginTop: 0 }}>Test Active Directory</h3>
        <p className="meta">Checks a real username and password against the saved settings. Nothing is stored.</p>
        <label className="label" htmlFor="test-user">Username</label>
        <input
          id="test-user"
          className="input"
          autoComplete="off"
          value={test.username}
          onChange={(e) => setTest((t) => ({ ...t, username: e.target.value }))}
        />
        <label className="label" htmlFor="test-pass" style={{ marginTop: 12 }}>Password</label>
        <input
          id="test-pass"
          className="input"
          type="password"
          autoComplete="off"
          value={test.password}
          onChange={(e) => setTest((t) => ({ ...t, password: e.target.value }))}
        />
        {testError && <div className="error" role="alert">{testError}</div>}
        {testResult && (
          <div className="ok">
            Signed in as {testResult.name} ({testResult.email}).
            {testResult.admin === true && " They would be a DocySign admin."}
            {testResult.admin === false && " They would be a regular user."}
          </div>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: 16 }}
          disabled={testing || !status.ldapReady || !test.username || !test.password}
          onClick={runTest}
        >
          {testing ? "Checking…" : "Test sign-in"}
        </button>
      </div>
    </>
  );
}
