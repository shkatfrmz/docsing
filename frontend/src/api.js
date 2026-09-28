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
  list: () => request("/api/envelopes"),
  inbox: () => request("/api/inbox"),
  library: () => request("/api/library"),
  stats: () => request("/api/stats"),
  mail: () => request("/api/mail"),
  mailOne: (id) => request(`/api/mail/${id}`),
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
  remove: (id) => request(`/api/envelopes/${id}`, { method: "DELETE" }),
  signInfo: (token) => request(`/api/sign/${token}`),
  sign: (token, values) =>
    request(`/api/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, origin: window.location.origin }),
    }),
};

export function fileUrl(id) {
  return `/api/envelopes/${id}/file?access=${encodeURIComponent(getToken())}`;
}

export function downloadUrl(id) {
  return `/api/envelopes/${id}/download?access=${encodeURIComponent(getToken())}`;
}
