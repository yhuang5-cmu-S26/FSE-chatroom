const base = import.meta.env.VITE_API_BASE_URL || '/api';
const key = 'social.jwt';
let token = localStorage.getItem(key) || '';

export const setToken = (value) => {
  token = value || '';
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
};
export const getToken = () => token;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'request failed');
  return data;
}

export const api = {
  enter: (body) => request('/auth/enter', { method: 'POST', body: JSON.stringify(body) }),
  post: (content) => request('/posts', { method: 'POST', body: JSON.stringify({ content }) }),
  group: (body) => request('/groups', { method: 'POST', body: JSON.stringify(body) }),
  task: (body) => request('/checkins', { method: 'POST', body: JSON.stringify(body) }),
  checkin: (id) => request(`/checkins/${id}/check-in`, { method: 'POST' }),
  speed: (body) => request('/stress/runs', { method: 'POST', body: JSON.stringify(body) }),
  agentChat: (message, sessionId = null) => request('/agent/chat', { method: 'POST', body: JSON.stringify({ message, sessionId }) }),
  agentSessions: () => request('/agent/sessions'),
  agentSessionMessages: (sessionId) => request(`/agent/sessions/${sessionId}/messages`),
  approveAgentPlan: (sessionId, messageId) => request(`/agent/sessions/${sessionId}/approve`, { method: 'POST', body: JSON.stringify({ messageId }) }),
  handoffAgentPlan: (sessionId, messageId, reason = '') => request(`/agent/sessions/${sessionId}/handoff`, { method: 'POST', body: JSON.stringify({ messageId, reason }) }),
};
