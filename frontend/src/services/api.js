const base = import.meta.env.VITE_API_BASE_URL || "/api",
  key = "social.jwt";
let token = localStorage.getItem(key) || "";
export const setToken = (v) => {
  token = v || "";
  token ? localStorage.setItem(key, token) : localStorage.removeItem(key);
};
export const getToken = () => token;
async function request(path, options = {}) {
  const r = await fetch(base + path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "request failed");
  return d;
}
export const api = {
  enter: (b) =>
    request("/auth/enter", { method: "POST", body: JSON.stringify(b) }),
  post: (c) =>
    request("/posts", {
      method: "POST",
      body: JSON.stringify({ content: c }),
      group: (b) =>
        request("/groups", { method: "POST", body: JSON.stringify(b) }),
      task: (b) =>
        request("/checkins", { method: "POST", body: JSON.stringify(b) }),
      checkin: (id) => request(`/checkins/${id}/check-in`, { method: "POST" }),
      speed: (b) =>
        request("/stress/runs", { method: "POST", body: JSON.stringify(b) }),
    }),
};
