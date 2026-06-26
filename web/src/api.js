const jsonHeaders = {
  'Content-Type': 'application/json',
};

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.message || 'Request failed.');
  }

  return body;
}

export const api = {
  getBranding: () => request('/api/branding'),
  getSettings: () => request('/api/settings'),
  saveSettings: (payload) =>
    request('/api/settings', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  scanMedia: (mediaPath) =>
    request('/api/scan', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ mediaPath }),
    }),
  startScan: (mediaPath) =>
    request('/api/scan/start', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ mediaPath }),
    }),
  getScanProgress: () => request('/api/scan/progress'),
  getStats: () => request('/api/stats'),
  getVideos: ({ offset = 0, limit = 30, search = '', filter = 'active', folder = 'all' }) =>
    request(
      `/api/videos?offset=${offset}&limit=${limit}&search=${encodeURIComponent(search)}&filter=${filter}&folder=${encodeURIComponent(folder)}`
    ),
  getFilterQueue: (scope, folder = 'all') =>
    request(`/api/filter/queue?scope=${scope}&folder=${encodeURIComponent(folder)}`),
  setDecision: (id, decision) =>
    request(`/api/videos/${id}/decision`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision }),
    }),
  moveVideo: (id, targetFolder) =>
    request(`/api/videos/${id}/move`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ targetFolder }),
    }),
  savePlayback: (id, positionSeconds) =>
    request(`/api/videos/${id}/playback`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ positionSeconds }),
    }),
  getTrash: () => request('/api/trash'),
  restoreTrash: (id) =>
    request(`/api/trash/${id}/restore`, {
      method: 'POST',
    }),
  permanentDelete: (id) =>
    request(`/api/trash/${id}/permanent`, {
      method: 'DELETE',
    }),
  permanentDeleteAllTrash: () =>
    request('/api/trash/permanent-all', {
      method: 'DELETE',
    }),
};
