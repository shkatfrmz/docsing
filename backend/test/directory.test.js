// Tests for signing in through a company directory, against local stand-ins
// for an LDAP server (Active Directory) and Microsoft Entra ID.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const ldap = require("ldapjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docysign-dir-"));
process.env.DOCYSIGN_DATA_DIR = path.join(tmp, "data");
process.env.DOCYSIGN_UPLOADS_DIR = path.join(tmp, "uploads");
for (const key of Object.keys(process.env)) {
  if (/^(LDAP_|ENTRA_|APP_URL$|ALLOW_SIGNUP$)/.test(key)) delete process.env[key];
}

const { app } = require("../server");

const BASE = "dc=corp,dc=example";
const STAFF = `cn=DocySign Users,ou=groups,${BASE}`;
const ADMINS = `cn=DocySign Admins,ou=groups,${BASE}`;
const PEOPLE = {
  [`cn=Huda Admin,ou=people,${BASE}`]: {
    password: "huda-pass",
    attrs: { sAMAccountName: "huda", userPrincipalName: "huda@corp.example", mail: "Huda@Corp.Example", displayName: "Huda Admin", memberOf: [STAFF, ADMINS] },
  },
  [`cn=Omar Staff,ou=people,${BASE}`]: {
    password: "omar-pass",
    attrs: { sAMAccountName: "omar", userPrincipalName: "omar@corp.example", mail: "omar@corp.example", displayName: "Omar Staff", memberOf: [STAFF] },
  },
  [`cn=Nora Outsider,ou=people,${BASE}`]: {
    password: "nora-pass",
    attrs: { sAMAccountName: "nora", userPrincipalName: "nora@corp.example", mail: "nora@corp.example", displayName: "Nora Outsider", memberOf: [] },
  },
};

let api;
let base;
let ldapServer;
let ldapUrl;
let ms;
let msClaims = {};
const binds = [];

function norm(dn) {
  return String(dn).replace(/\s*,\s*/g, ",").toLowerCase();
}

test.before(async () => {
  api = app.listen(0, "127.0.0.1");
  await new Promise((r) => api.once("listening", r));
  base = `http://127.0.0.1:${api.address().port}`;

  ldapServer = ldap.createServer();
  ldapServer.bind(BASE, (req, res, next) => {
    const dn = norm(req.dn.toString());
    binds.push({ dn, empty: !req.credentials });
    if (dn === norm(`cn=svc,${BASE}`)) {
      return req.credentials === "svc-pass" ? res.end() : next(new ldap.InvalidCredentialsError());
    }
    const found = Object.entries(PEOPLE).find(([key]) => norm(key) === dn);
    if (!found || found[1].password !== req.credentials) return next(new ldap.InvalidCredentialsError());
    res.end();
  });
  ldapServer.search(BASE, (req, res) => {
    // Return every attribute: this stand-in's own filtering of requested
    // attribute names is case-sensitive, unlike a real directory.
    res.attributes = [];
    for (const [dn, person] of Object.entries(PEOPLE)) {
      if ((req.scope === "base" || req.scope === 0) && norm(req.dn.toString()) !== norm(dn)) continue;
      let matches = false;
      try { matches = req.filter.matches(person.attrs); } catch { matches = false; }
      if (matches) res.send({ dn, attributes: person.attrs });
    }
    res.end();
  });
  await new Promise((r) => ldapServer.listen(0, "127.0.0.1", r));
  ldapUrl = `ldap://127.0.0.1:${ldapServer.address().port}`;

  ms = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      res.setHeader("Content-Type", "application/json");
      if (form.get("client_secret") !== "entra-secret" || form.get("code") !== "good-code" || !form.get("code_verifier")) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: "invalid_grant" }));
      }
      const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
      res.end(JSON.stringify({ id_token: `${part({ alg: "none" })}.${part(msClaims)}.sig` }));
    });
  });
  await new Promise((r) => ms.listen(0, "127.0.0.1", r));
  process.env.MS_LOGIN_URL = `http://127.0.0.1:${ms.address().port}`;
});

test.after(async () => {
  api.close();
  ms.close();
  await new Promise((r) => ldapServer.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(method, url, { token, body, headers, redirect } = {}) {
  const res = await fetch(base + url, {
    method,
    redirect: redirect || "follow",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
  return { status: res.status, data, location: res.headers.get("location") };
}

const login = (email, password) => call("POST", "/api/auth/login", { body: { email, password } });
let admin;

test("the first local account is the admin and can turn on directory sign-in", async () => {
  const signup = await call("POST", "/api/auth/signup", { body: { name: "Local Admin", email: "root@example.com", password: "secret1" } });
  assert.equal(signup.status, 201);
  admin = signup.data.token;
  assert.deepEqual((await call("GET", "/api/auth/options")).data, { localSignup: true, ldap: false, entra: false });

  const bad = await call("PUT", "/api/settings/auth", { token: admin, body: { ldap: { enabled: true, url: "corp.example" } } });
  assert.equal(bad.status, 400);

  const saved = await call("PUT", "/api/settings/auth", {
    token: admin,
    body: {
      localSignup: false,
      ldap: { enabled: true, url: ldapUrl, bindDn: `cn=svc,${BASE}`, bindPassword: "svc-pass", baseDn: BASE, allowedGroup: STAFF, adminGroup: ADMINS },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.ldap.ready, true);
  assert.equal(saved.data.ldap.hasBindPassword, true);
  assert.equal(saved.data.ldap.bindPassword, undefined, "the service password is never sent back");
  assert.deepEqual((await call("GET", "/api/auth/options")).data, { localSignup: false, ldap: true, entra: false });

  const outsider = await call("GET", "/api/settings/auth");
  assert.equal(outsider.status, 401);
});

test("directory users sign in with their username, UPN or email and get an account", async () => {
  for (const name of ["omar", "omar@corp.example"]) {
    const res = await login(name, "omar-pass");
    assert.equal(res.status, 200, name);
    assert.equal(res.data.user.email, "omar@corp.example");
    assert.equal(res.data.user.name, "Omar Staff");
    assert.equal(res.data.user.role, "user");
    assert.equal(res.data.user.authSource, "ldap");
  }
  const users = await call("GET", "/api/admin/users", { token: admin });
  assert.equal(users.data.filter((u) => u.email === "omar@corp.example").length, 1, "one account, not one per sign-in");
});

test("the admin group maps to the admin role, and follows the directory", async () => {
  const huda = await login("huda", "huda-pass");
  assert.equal(huda.status, 200);
  assert.equal(huda.data.user.role, "admin");
  assert.equal(huda.data.user.email, "huda@corp.example");
  assert.equal((await call("GET", "/api/admin/users", { token: huda.data.token })).status, 200);

  PEOPLE[`cn=Huda Admin,ou=people,${BASE}`].attrs.memberOf = [STAFF];
  const later = await login("huda", "huda-pass");
  assert.equal(later.data.user.role, "user", "removed from the group, so no longer an admin");
});

test("wrong passwords, empty passwords, unknown users and outsiders are refused", async () => {
  assert.equal((await login("omar", "wrong")).status, 401);
  assert.equal((await login("nobody", "whatever")).status, 401);

  binds.length = 0;
  assert.equal((await login("omar", "")).status, 401);
  assert.equal(binds.length, 0, "an empty password never reaches the directory");

  const injected = await login("*)(mail=*", "omar-pass");
  assert.equal(injected.status, 401, "filter characters in a username are escaped");

  const nora = await login("nora", "nora-pass");
  assert.equal(nora.status, 403);
  assert.match(nora.data.error, /not in the group/);
});

test("local accounts keep working, sign-up is closed, directory users cannot set a local password", async () => {
  assert.equal((await login("root@example.com", "secret1")).status, 200);
  const signup = await call("POST", "/api/auth/signup", { body: { name: "Walk In", email: "walkin@example.com", password: "secret1" } });
  assert.equal(signup.status, 403);
  const omar = await login("omar", "omar-pass");
  const change = await call("POST", "/api/auth/password", { token: omar.data.token, body: { currentPassword: "omar-pass", password: "newpass1" } });
  assert.equal(change.status, 400);
  assert.match(change.data.error, /company directory/);
});

test("the admin test button reports what the directory returned", async () => {
  const ok = await call("POST", "/api/settings/auth/ldap/test", { token: admin, body: { username: "omar", password: "omar-pass" } });
  assert.equal(ok.status, 200);
  assert.deepEqual({ email: ok.data.email, name: ok.data.name, admin: ok.data.admin }, { email: "omar@corp.example", name: "Omar Staff", admin: false });
  const no = await call("POST", "/api/settings/auth/ldap/test", { token: admin, body: { username: "omar", password: "nope" } });
  assert.equal(no.status, 400);
});

test("an unreachable directory is reported as such, not as a wrong password", async () => {
  const current = (await call("GET", "/api/settings/auth", { token: admin })).data;
  await call("PUT", "/api/settings/auth", { token: admin, body: { ...current, ldap: { ...current.ldap, url: "ldap://127.0.0.1:1" } } });
  const res = await login("omar", "omar-pass");
  assert.equal(res.status, 502);
  assert.match(res.data.error, /Could not reach the directory/);
  assert.equal((await login("root@example.com", "secret1")).status, 200, "local admin can still get in to fix it");
  await call("PUT", "/api/settings/auth", { token: admin, body: { ...current, ldap: { ...current.ldap, url: ldapUrl } } });
  assert.equal((await login("omar", "omar-pass")).status, 200, "the saved service password was kept");
});

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const GROUP_USERS = "99999999-0000-0000-0000-000000000001";
const GROUP_ADMINS = "99999999-0000-0000-0000-000000000002";

async function microsoftSignIn(claims, { code = "good-code", next } = {}) {
  const start = await call("GET", `/api/auth/entra/start${next ? `?next=${encodeURIComponent(next)}` : ""}`, {
    redirect: "manual",
    headers: { Referer: "https://sign.corp.example/login" },
  });
  assert.equal(start.status, 302);
  const authorize = new URL(start.location);
  msClaims = { aud: CLIENT, tid: TENANT, exp: Math.floor(Date.now() / 1000) + 600, nonce: authorize.searchParams.get("nonce"), ...claims };
  const back = await call("GET", `/api/auth/entra/callback?code=${code}&state=${authorize.searchParams.get("state")}`, { redirect: "manual" });
  return { authorize, back: new URL(back.location), state: authorize.searchParams.get("state") };
}

test("Sign in with Microsoft: full round trip, group mapping and one-time handoff", async () => {
  const current = (await call("GET", "/api/settings/auth", { token: admin })).data;
  const saved = await call("PUT", "/api/settings/auth", {
    token: admin,
    body: { ...current, entra: { enabled: true, tenantId: TENANT, clientId: CLIENT, clientSecret: "entra-secret", allowedGroup: GROUP_USERS, adminGroup: GROUP_ADMINS } },
  });
  assert.equal(saved.data.entra.ready, true);
  assert.equal((await call("GET", "/api/auth/options")).data.entra, true);

  const { authorize, back, state } = await microsoftSignIn(
    { preferred_username: "Layla@Corp.Example", name: "Layla Cloud", groups: [GROUP_USERS, GROUP_ADMINS] },
    { next: "/envelope/abc" }
  );
  assert.equal(authorize.pathname, `/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(authorize.searchParams.get("client_id"), CLIENT);
  assert.equal(authorize.searchParams.get("redirect_uri"), "https://sign.corp.example/api/auth/entra/callback");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(back.origin + back.pathname, "https://sign.corp.example/auth/callback");
  assert.equal(back.searchParams.get("next"), "/envelope/abc");
  assert.equal(back.searchParams.get("token"), null, "the session is not put in the address");

  const code = back.searchParams.get("code");
  const session = await call("POST", "/api/auth/exchange", { body: { code } });
  assert.equal(session.status, 200);
  assert.equal(session.data.user.email, "layla@corp.example");
  assert.equal(session.data.user.role, "admin");
  assert.equal(session.data.user.authSource, "entra");
  assert.equal((await call("GET", "/api/auth/me", { token: session.data.token })).status, 200);
  assert.equal((await call("POST", "/api/auth/exchange", { body: { code } })).status, 400, "the handoff code works once");

  const replay = await call("GET", `/api/auth/entra/callback?code=good-code&state=${state}`, { redirect: "manual" });
  assert.match(new URL(replay.location).searchParams.get("error"), /took too long or was already used/);
});

test("Sign in with Microsoft: refusals", async () => {
  const error = (r) => r.back.searchParams.get("error") || "";
  assert.match(error(await microsoftSignIn({ preferred_username: "x@corp.example", groups: [] })), /not in the group/);
  assert.match(error(await microsoftSignIn({ preferred_username: "x@corp.example" })), /groups claim/);
  assert.match(error(await microsoftSignIn({ preferred_username: "x@corp.example", hasgroups: true })), /too many groups/);
  assert.match(error(await microsoftSignIn({ preferred_username: "x@other.example", groups: [GROUP_USERS], tid: "00000000-0000-0000-0000-000000000000" })), /different organisation/);
  assert.match(error(await microsoftSignIn({ preferred_username: "x@corp.example", groups: [GROUP_USERS], aud: "someone-else" })), /different application/);
  assert.match(error(await microsoftSignIn({ preferred_username: "x@corp.example", groups: [GROUP_USERS], nonce: "forged" })), /could not be verified/);
  assert.match(error(await microsoftSignIn({ preferred_username: "x@corp.example", groups: [GROUP_USERS] }, { code: "bad-code" })), /could not complete/);

  const outside = await microsoftSignIn({ preferred_username: "x@corp.example", groups: [GROUP_USERS] }, { next: "//evil.example" });
  assert.equal(outside.back.searchParams.get("next"), null, "only paths inside the app are followed");
});
