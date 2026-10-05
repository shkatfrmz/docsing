const TOKEN_KEY = "docysign_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth/login")) {
    setToken("");
  }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
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
      body: JSON.stringify({ origin: window.location.origin }),
    }),
  remind: (id, signerId) =>
    request(`/api/envelopes/${id}/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: window.location.origin, signerId }),
    }),
  voidEnvelope: (id, reason) =>
    request(`/api/envelopes/${id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, origin: window.location.origin }),
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
      body: JSON.stringify({ values, origin: window.location.origin }),
    }),
  decline: (token, reason) =>
    request(`/api/sign/${token}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, origin: window.location.origin }),
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

export function fileUrl(id) {
  return `/api/envelopes/${id}/file?access=${encodeURIComponent(getToken())}`;
}

export function downloadUrl(id) {
  return `/api/envelopes/${id}/download?access=${encodeURIComponent(getToken())}`;
}
