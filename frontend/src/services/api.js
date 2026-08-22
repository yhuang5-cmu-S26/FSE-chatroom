const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'request failed');
  }

  return data;
}

export const api = {
  getHealth: () => request('/health'),
  listCheckins: () => request('/checkins'),
  createCheckin: (payload) => request('/checkins', { method: 'POST', body: JSON.stringify(payload) }),
  listHelpRequests: () => request('/help-requests'),
  createHelpRequest: (payload) =>
    request('/help-requests', { method: 'POST', body: JSON.stringify(payload) }),
  updateHelpStatus: (id, status) =>
    request(`/help-requests/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  listLocations: () => request('/locations'),
  createLocation: (payload) => request('/locations', { method: 'POST', body: JSON.stringify(payload) }),
};
