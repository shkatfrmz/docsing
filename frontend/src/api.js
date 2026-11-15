const TOKEN_KEY = "docysign_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Fired when the server no longer accepts the saved session, so the app can
// drop the signed-in user instead of showing pages that will keep failing.
export const SIGNED_OUT_EVENT = "docysign:signed-out";

function noteSignedOut(url) {
  if (url.startsWith("/api/auth/login") || url.startsWith("/api/auth/exchange")) return;
  const had = !!getToken();
  setToken("");
  if (had) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeaders() };
  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) noteSignedOut(url);
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** Fetches a protected file. The session is sent as a header, never in the URL. */
export async function fetchFile(url) {
  let res;
  try {
    res = await fetch(url, { headers: authHeaders() });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (res.status === 401) noteSignedOut(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not load the file");
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  let name = "";
  if (match) {
    try { name = decodeURIComponent(match[1] || match[2]); } catch { name = match[2] || ""; }
  }
  return { blob: await res.blob(), name };
}

/** Saves the envelope's PDF (the signed copy once completed) to the device. */
export async function downloadEnvelope(id) {
  const { blob, name } = await fetchFile(`/api/envelopes/${id}/download`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "document.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Opens the browser's print dialog for the envelope's PDF. */
export async function printEnvelope(id) {
  const { blob } = await fetchFile(`/api/envelopes/${id}/file`);
  const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      // Some browsers will not print an embedded PDF: show it in a tab instead.
      window.open(url, "_blank");
    }
  };
  document.body.appendChild(frame);
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 5 * 60 * 1000);
}

/** Only follow "next" links that stay inside this app. */
export function safeNext(next, fallback = "/app") {
  return typeof next === "string" && /^\/(?![\/\\])/.test(next) ? next : fallback;
}

export const api = {
  me: () => request("/api/auth/me"),
  signup: (body) =>
    request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  login: (body) =>
    request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  changePassword: (body) =>
    request("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateProfile: (body) =>
    request("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  signature: () => request("/api/auth/signature"),
  contacts: () => request("/api/contacts"),
  addContact: (body) =>
    request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteContact: (id) => request(`/api/contacts/${id}`, { method: "DELETE" }),
  templates: () => request("/api/templates"),
  useTemplate: (id) => request(`/api/templates/${id}/use`, { method: "POST" }),
  deleteTemplate: (id) => request(`/api/templates/${id}`, { method: "DELETE" }),
  list: () => request("/api/envelopes"),
  inbox: () => request("/api/inbox"),
  library: () => request("/api/library"),
  stats: () => request("/api/stats"),
  mail: () => request("/api/mail"),
  mailOne: (id) => request(`/api/mail/${id}`),
  authOptions: () => request("/api/auth/options"),
  exchange: (code) =>
    request("/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  authSettings: () => request("/api/settings/auth"),
  saveAuthSettings: (body) =>
    request("/api/settings/auth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  testDirectory: (username, password) =>
    request("/api/settings/auth/ldap/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  smtp: () => request("/api/settings/smtp"),
  saveSmtp: (body) =>
    request("/api/settings/smtp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  testSmtp: (to) =>
    request("/api/settings/smtp/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    }),
  get: (id) => request(`/api/envelopes/${id}`),
  create: (file, title) => {
    const fd = new FormData();
    fd.append("file", file);
    if (title) fd.append("title", title);
    return request("/api/envelopes", { method: "POST", body: fd });
  },
  sample: () => request("/api/envelopes/sample", { method: "POST" }),
  update: (id, body) =>
    request(`/api/envelopes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  send: (id) =>
    request(`/api/envelopes/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  remind: (id, signerId) =>
    request(`/api/envelopes/${id}/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerId }),
    }),
  voidEnvelope: (id, reason) =>
    request(`/api/envelopes/${id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  duplicate: (id) => request(`/api/envelopes/${id}/duplicate`, { method: "POST" }),
  saveTemplate: (id, title) =>
    request(`/api/envelopes/${id}/template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  remove: (id) => request(`/api/envelopes/${id}`, { method: "DELETE" }),
  signInfo: (token) => request(`/api/sign/${token}`),
  sign: (token, values) =>
    request(`/api/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    }),
  decline: (token, reason) =>
    request(`/api/sign/${token}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  adminStats: () => request("/api/admin/stats"),
  adminUsers: () => request("/api/admin/users"),
  adminCreateUser: (body) =>
    request("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  adminSetRole: (id, role) =>
    request(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }),
  adminDeleteUser: (id) => request(`/api/admin/users/${id}`, { method: "DELETE" }),
  adminResetPassword: (id, password) =>
    request(`/api/admin/users/${id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  adminEnvelopes: () => request("/api/admin/envelopes"),
};
