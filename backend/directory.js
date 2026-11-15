// Sign-in through a company directory: Active Directory over LDAP, and
// Microsoft Entra ID single sign-on (OpenID Connect). People who sign in
// this way get a DocySign account automatically; their password is never
// stored here.
const crypto = require("crypto");
const { Client, InvalidCredentialsError } = require("ldapts");
const store = require("./store");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_USER_FILTER =
  "(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}}))";
// Active Directory's rule for "is a member of this group, directly or
// through other groups".
const NESTED_MEMBER_RULE = "1.2.840.113556.1.4.1941";

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const text = (value) => String(value == null ? "" : value).trim();
const flag = (value) => value === true || String(value).toLowerCase() === "true";

function envSettings() {
  const env = process.env;
  return {
    localSignup: String(env.ALLOW_SIGNUP || "true").toLowerCase() !== "false",
    ldap: {
      enabled: !!env.LDAP_URL,
      url: text(env.LDAP_URL),
      bindDn: text(env.LDAP_BIND_DN),
      bindPassword: env.LDAP_BIND_PASSWORD || "",
      baseDn: text(env.LDAP_BASE_DN),
      userFilter: text(env.LDAP_USER_FILTER),
      allowedGroup: text(env.LDAP_ALLOWED_GROUP),
      adminGroup: text(env.LDAP_ADMIN_GROUP),
      startTls: flag(env.LDAP_START_TLS),
      allowSelfSigned: flag(env.LDAP_ALLOW_SELF_SIGNED),
    },
    entra: {
      enabled: !!(env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID),
      tenantId: text(env.ENTRA_TENANT_ID),
      clientId: text(env.ENTRA_CLIENT_ID),
      clientSecret: env.ENTRA_CLIENT_SECRET || "",
      allowedGroup: text(env.ENTRA_ALLOWED_GROUP),
      adminGroup: text(env.ENTRA_ADMIN_GROUP),
    },
  };
}

// Settings saved in Admin win over environment variables, section by section.
function getSettings() {
  const saved = store.getAuthSettings();
  const env = envSettings();
  if (!saved) return env;
  return {
    localSignup: typeof saved.localSignup === "boolean" ? saved.localSignup : env.localSignup,
    ldap: saved.ldap ? { ...env.ldap, ...saved.ldap } : env.ldap,
    entra: saved.entra ? { ...env.entra, ...saved.entra } : env.entra,
  };
}

function ldapReady(s) {
  return !!(s.ldap.enabled && s.ldap.url && s.ldap.baseDn);
}

function entraReady(s) {
  return !!(s.entra.enabled && s.entra.tenantId && s.entra.clientId && s.entra.clientSecret);
}

// What the sign-in page needs to know. Safe to show to anyone.
function publicOptions() {
  const s = getSettings();
  return {
    localSignup: s.localSignup || store.countUsers() === 0,
    ldap: ldapReady(s),
    entra: entraReady(s),
  };
}

// For the Admin form: everything except the secrets themselves.
function adminView() {
  const s = getSettings();
  return {
    localSignup: s.localSignup,
    ldap: {
      enabled: !!s.ldap.enabled,
      ready: ldapReady(s),
      url: s.ldap.url,
      bindDn: s.ldap.bindDn,
      hasBindPassword: !!s.ldap.bindPassword,
      baseDn: s.ldap.baseDn,
      userFilter: s.ldap.userFilter,
      allowedGroup: s.ldap.allowedGroup,
      adminGroup: s.ldap.adminGroup,
      startTls: !!s.ldap.startTls,
      allowSelfSigned: !!s.ldap.allowSelfSigned,
    },
    entra: {
      enabled: !!s.entra.enabled,
      ready: entraReady(s),
      tenantId: s.entra.tenantId,
      clientId: s.entra.clientId,
      hasClientSecret: !!s.entra.clientSecret,
      allowedGroup: s.entra.allowedGroup,
      adminGroup: s.entra.adminGroup,
    },
  };
}

function saveSettings(input) {
  const current = getSettings();
  const body = input || {};
  const ldap = body.ldap || {};
  const entra = body.entra || {};
  const url = text(ldap.url);
  if (url && !/^ldaps?:\/\/[^\s/]+/i.test(url)) {
    throw fail(400, "The directory server address must start with ldap:// or ldaps://");
  }
  const filter = text(ldap.userFilter);
  if (filter && !filter.includes("{{username}}")) {
    throw fail(400, "The user filter must contain {{username}}");
  }
  // A blank secret means "keep the one already saved".
  const keep = (value, old) => (value === undefined || value === "" ? old || "" : String(value));
  store.saveAuthSettings({
    localSignup: body.localSignup !== false,
    ldap: {
      enabled: !!ldap.enabled,
      url,
      bindDn: text(ldap.bindDn),
      bindPassword: keep(ldap.bindPassword, current.ldap.bindPassword),
      baseDn: text(ldap.baseDn),
      userFilter: filter,
      allowedGroup: text(ldap.allowedGroup),
      adminGroup: text(ldap.adminGroup),
      startTls: !!ldap.startTls,
      allowSelfSigned: !!ldap.allowSelfSigned,
    },
    entra: {
      enabled: !!entra.enabled,
      tenantId: text(entra.tenantId),
      clientId: text(entra.clientId),
      clientSecret: keep(entra.clientSecret, current.entra.clientSecret),
      allowedGroup: text(entra.allowedGroup),
      adminGroup: text(entra.adminGroup),
    },
  });
  return adminView();
}

// ---------------------------------------------------------------- LDAP

// RFC 4515: characters with a meaning inside a search filter.
function escapeFilter(value) {
  return String(value).replace(/[\\*()\0]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function first(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return v == null ? "" : String(v);
}

function list(value) {
  if (value == null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

const sameDn = (a, b) => a.replace(/\s*,\s*/g, ",").toLowerCase() === b.replace(/\s*,\s*/g, ",").toLowerCase();

function tlsOptions(cfg) {
  return { rejectUnauthorized: !cfg.allowSelfSigned };
}

// ldaps:// is encrypted from the start. ldap:// is plain unless StartTLS is
// switched on, in which case the connection is upgraded before signing in.
async function connect(cfg) {
  const secure = /^ldaps:/i.test(cfg.url);
  const client = new Client({
    url: cfg.url,
    timeout: 10000,
    connectTimeout: 10000,
    ...(secure ? { tlsOptions: tlsOptions(cfg) } : {}),
  });
  if (!secure && cfg.startTls) {
    try {
      await client.startTLS(tlsOptions(cfg));
    } catch (err) {
      await client.unbind().catch(() => {});
      throw unreachable(err);
    }
  }
  return client;
}

async function inGroup(client, cfg, entry, groupDn) {
  if (list(entry.memberof).some((dn) => sameDn(dn, groupDn))) return true;
  try {
    // Membership through nested groups. Only Active Directory understands
    // this rule; other directories reject it, which just means "no".
    const { searchEntries } = await client.search(entry.dn, {
      scope: "base",
      filter: `(memberOf:${NESTED_MEMBER_RULE}:=${escapeFilter(groupDn)})`,
      attributes: ["dn"],
    });
    return searchEntries.length > 0;
  } catch {
    return false;
  }
}

function unreachable(err) {
  return fail(502, `Could not reach the directory server: ${err.message}`);
}

/**
 * Checks a username and password against the directory.
 * Returns null when the directory says the credentials are wrong, throws a
 * readable error for anything else, and otherwise returns
 * { email, name, admin } where admin is undefined unless an admin group is set.
 */
async function ldapAuthenticate(username, password, override) {
  const cfg = override || getSettings().ldap;
  const name = text(username);
  // An empty password would succeed as an "unauthenticated bind" on many
  // servers, so it must never reach the directory.
  if (!name || !password) return null;

  const search = await connect(cfg);
  try {
    try {
      if (cfg.bindDn) await search.bind(cfg.bindDn, cfg.bindPassword);
      else await search.bind(name, password);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        if (!cfg.bindDn) return null;
        throw fail(502, "The directory rejected the service account. Check its name and password in Admin.");
      }
      throw unreachable(err);
    }

    const filter = (cfg.userFilter || DEFAULT_USER_FILTER).replace(/\{\{username\}\}/g, escapeFilter(name));
    let entries;
    try {
      ({ searchEntries: entries } = await search.search(cfg.baseDn, {
        scope: "sub",
        filter,
        sizeLimit: 2,
        attributes: ["mail", "userPrincipalName", "displayName", "cn", "memberOf"],
      }));
    } catch (err) {
      throw fail(502, `The directory search failed: ${err.message}`);
    }
    if (entries.length !== 1) return null;
    // Servers differ in how they capitalise attribute names.
    const entry = { dn: entries[0].dn };
    for (const [key, value] of Object.entries(entries[0])) entry[key.toLowerCase()] = value;

    if (cfg.bindDn) {
      // Prove the password by signing in as the person on a fresh connection.
      const asUser = await connect(cfg);
      try {
        await asUser.bind(entry.dn, password);
      } catch (err) {
        if (err instanceof InvalidCredentialsError) return null;
        throw unreachable(err);
      } finally {
        await asUser.unbind().catch(() => {});
      }
    }

    const email = [first(entry.mail), first(entry.userprincipalname)].find((v) => EMAIL_RE.test(v));
    if (!email) throw fail(403, "Your directory account has no email address, so it cannot be used here.");
    if (cfg.allowedGroup && !(await inGroup(search, cfg, entry, cfg.allowedGroup))) {
      throw fail(403, "Your account is not in the group that is allowed to use DocySign.");
    }
    return {
      email: email.toLowerCase(),
      name: first(entry.displayname) || first(entry.cn) || email,
      admin: cfg.adminGroup ? await inGroup(search, cfg, entry, cfg.adminGroup) : undefined,
    };
  } finally {
    await search.unbind().catch(() => {});
  }
}

// ---------------------------------------------------------------- Entra ID

const PENDING_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 60 * 1000;
const pending = new Map(); // state -> sign-in in progress
const handoffs = new Map(); // one-time code -> session token

function sweep(map, ttl) {
  const now = Date.now();
  for (const [key, value] of map) if (now - value.at > ttl) map.delete(key);
}

function loginBase() {
  return (process.env.MS_LOGIN_URL || "https://login.microsoftonline.com").replace(/\/+$/, "");
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Returns the Microsoft address to send the browser to. */
function entraStart({ origin, next }) {
  const cfg = getSettings().entra;
  sweep(pending, PENDING_TTL_MS);
  if (pending.size > 5000) throw fail(503, "Too many sign-ins in progress. Try again in a minute.");
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const redirectUri = `${origin}/api/auth/entra/callback`;
  pending.set(state, { at: Date.now(), nonce, verifier, redirectUri, origin, next });
  const query = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  });
  return `${loginBase()}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize?${query}`;
}

function readIdToken(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw fail(502, "Microsoft returned a sign-in token that could not be read.");
  }
}

/** Finishes a sign-in. Returns { origin, next, person: { email, name, admin } }. */
async function entraFinish({ code, state }) {
  const cfg = getSettings().entra;
  const entry = pending.get(String(state || ""));
  pending.delete(String(state || ""));
  if (!entry || Date.now() - entry.at > PENDING_TTL_MS) {
    throw fail(400, "That sign-in took too long or was already used. Please try again.");
  }
  let res;
  try {
    res = await fetch(`${loginBase()}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "authorization_code",
        code: String(code || ""),
        redirect_uri: entry.redirectUri,
        code_verifier: entry.verifier,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw fail(502, `Could not reach Microsoft to finish signing in: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) {
    const detail = /AADSTS7000215|invalid_client/.test(`${data.error} ${data.error_description}`)
      ? "Microsoft rejected the client secret saved in Admin."
      : "Microsoft could not complete the sign-in.";
    const err = fail(502, detail);
    err.origin = entry.origin;
    throw err;
  }

  // The token came straight from Microsoft over TLS in exchange for our
  // secret, so its origin is established; check it was issued for this app,
  // this tenant and this sign-in.
  const claims = readIdToken(data.id_token);
  try {
    const guid = /^[0-9a-f-]{36}$/i;
    if (claims.aud !== cfg.clientId) throw fail(403, "That sign-in was issued for a different application.");
    if (guid.test(cfg.tenantId) && String(claims.tid || "").toLowerCase() !== cfg.tenantId.toLowerCase()) {
      throw fail(403, "That Microsoft account belongs to a different organisation.");
    }
    if (claims.nonce !== entry.nonce) throw fail(403, "That sign-in could not be verified. Please try again.");
    if (!claims.exp || claims.exp * 1000 < Date.now()) throw fail(403, "That sign-in has expired. Please try again.");

    const email = [claims.email, claims.preferred_username, claims.upn].map(text).find((v) => EMAIL_RE.test(v));
    if (!email) throw fail(403, "Your Microsoft account has no email address, so it cannot be used here.");

    const needsGroups = !!(cfg.allowedGroup || cfg.adminGroup);
    const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : null;
    if (needsGroups && !groups) {
      const overflow = claims.hasgroups || (claims._claim_names && claims._claim_names.groups);
      throw fail(
        403,
        overflow
          ? "This account is in too many groups for Microsoft to list. In the app registration's token configuration, limit the groups claim to groups assigned to the application."
          : "Microsoft did not say which groups this account is in. Add the groups claim to the ID token in the app registration's token configuration."
      );
    }
    const has = (id) => groups.some((g) => g.toLowerCase() === id.toLowerCase());
    if (cfg.allowedGroup && !has(cfg.allowedGroup)) {
      throw fail(403, "Your account is not in the group that is allowed to use DocySign.");
    }
    return {
      origin: entry.origin,
      next: entry.next,
      person: {
        email: email.toLowerCase(),
        name: text(claims.name) || email,
        admin: cfg.adminGroup ? has(cfg.adminGroup) : undefined,
      },
    };
  } catch (err) {
    err.origin = entry.origin;
    throw err;
  }
}

// The browser comes back from Microsoft on a page address, so the session is
// handed over with a short-lived, single-use code instead of in the URL.
function createHandoff(sessionToken) {
  sweep(handoffs, HANDOFF_TTL_MS);
  const code = b64url(crypto.randomBytes(24));
  handoffs.set(code, { at: Date.now(), sessionToken });
  return code;
}

function redeemHandoff(code) {
  const entry = handoffs.get(String(code || ""));
  handoffs.delete(String(code || ""));
  if (!entry || Date.now() - entry.at > HANDOFF_TTL_MS) return null;
  return entry.sessionToken;
}

module.exports = {
  DEFAULT_USER_FILTER,
  getSettings,
  publicOptions,
  adminView,
  saveSettings,
  ldapReady,
  entraReady,
  ldapAuthenticate,
  entraStart,
  entraFinish,
  createHandoff,
  redeemHandoff,
};
