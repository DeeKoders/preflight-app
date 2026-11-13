import { APP_NAME } from './brand';

/** Thin fetch wrapper. Session auth uses an httpOnly cookie — no tokens are stored in JS. */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code || 'UNKNOWN';
    this.details = body?.error?.details;
    this.service = body?.error?.service;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(method, path, body, { raw = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK_ERROR', message: `Could not reach the ${APP_NAME} server. Check your connection.` } });
  }
  if (raw && res.ok) return res;
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    // Only a lost *session* triggers the global sign-out; /auth/* calls handle 401 themselves,
    // and integration 401s (Jira/GitHub/AI rejecting a key) carry a `service` and are shown inline.
    if (res.status === 401 && !path.startsWith('/auth/') && !err.service) onUnauthorized();
    throw err;
  }
  return data.data;
}

const qs = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const api = {
  get: (p, params) => request('GET', `${p}${qs(params)}`),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  delete: (p) => request('DELETE', p),
  raw: (p) => request('GET', p, undefined, { raw: true }),
};
