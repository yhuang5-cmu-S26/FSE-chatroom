const base = import.meta.env.VITE_API_BASE_URL || "/api";
const key = "social.jwt";
let token = localStorage.getItem(key) || "";

export const setToken = (value) => {
  token = value || "";
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
};
export const getToken = () => token;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // A reverse proxy may return a non-JSON error page; preserve its status.
  }
  if (!response.ok)
    throw new Error(data.error || `request failed (HTTP ${response.status})`);
  return data;
}

async function requestStream(path, body, handlers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw new Error("stream request failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = done ? "" : frames.pop();
    for (const frame of frames) {
      const event = frame.match(/^event:\s*(.+)$/m)?.[1];
      const raw = frame.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !raw) continue;
      const data = JSON.parse(raw);
      if (event === "delta") handlers.onDelta?.(data.text || "");
      if (event === "result") handlers.onResult?.(data);
      if (event === "error")
        throw new Error(data.error || "streaming request failed");
    }
    if (done) break;
  }
}

export const api = {
  enter: (body) =>
    request("/auth/enter", { method: "POST", body: JSON.stringify(body) }),
  post: (content) =>
    request("/posts", { method: "POST", body: JSON.stringify({ content }) }),
  group: (body) =>
    request("/groups", { method: "POST", body: JSON.stringify(body) }),
  task: (body) =>
    request("/checkins", { method: "POST", body: JSON.stringify(body) }),
  checkin: (id) => request(`/checkins/${id}/check-in`, { method: "POST" }),
  speed: (body) =>
    request("/stress/runs", { method: "POST", body: JSON.stringify(body) }),
  agentChat: (message, sessionId = null) =>
    request("/agent/chat", {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),
  agentChatStream: (message, sessionId, handlers) =>
    requestStream("/agent/chat/stream", { message, sessionId }, handlers),
  agentSessions: () => request("/agent/sessions"),
  deleteAgentSession: (sessionId) =>
    request(`/agent/sessions/${sessionId}`, { method: "DELETE" }),
  agentSessionMessages: (sessionId) =>
    request(`/agent/sessions/${sessionId}/messages`),
  agentMonitor: (sessionId) =>
    request(`/agent/sessions/${sessionId}/monitor`),
  runAgentTests: (cases) =>
    request("/agent/monitor/tests", {
      method: "POST",
      body: JSON.stringify({ cases }),
    }),
  approveAgentPlan: (sessionId, messageId) =>
    request(`/agent/sessions/${sessionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ messageId }),
    }),
  handoffAgentPlan: (sessionId, messageId, reason = "") =>
    request(`/agent/sessions/${sessionId}/handoff`, {
      method: "POST",
      body: JSON.stringify({ messageId, reason }),
    }),
  retryAgentRun: (sessionId, runId) =>
    request(`/agent/sessions/${sessionId}/runs/${runId}/retry`, {
      method: "POST",
    }),
  resumeAgentRun: (sessionId, runId, body) =>
    request(`/agent/sessions/${sessionId}/runs/${runId}/resume`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
