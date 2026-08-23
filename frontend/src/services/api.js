const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const TOKEN_KEY = 'esn.jwt.token';

let authToken = localStorage.getItem(TOKEN_KEY) || '';

export function setAuthToken(token) {
  authToken = typeof token === 'string' ? token : '';
  if (authToken) localStorage.setItem(TOKEN_KEY, authToken);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken() {
  return authToken;
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'request failed');
  }

  return data;
}

export const api = {
  getHealth: () => request('/health'),
  register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/auth/me'),
  listCheckins: () => request('/checkins'),
  createCheckin: (payload) => request('/checkins', { method: 'POST', body: JSON.stringify(payload) }),
  updateCheckinStatus: (id, status) =>
    request(`/checkins/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  adminUpdateCheckin: (id, payload) =>
    request(`/checkins/${id}/admin`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCheckin: (id) =>
    request(`/checkins/${id}`, {
      method: 'DELETE',
    }),
  listHelpRequests: () => request('/help-requests'),
  createHelpRequest: (payload) =>
    request('/help-requests', { method: 'POST', body: JSON.stringify(payload) }),
  updateHelpStatus: (id, status) =>
    request(`/help-requests/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  runStressTest: () => request('/stress/run', { method: 'POST' }),
};
