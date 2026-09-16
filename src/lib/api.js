const TOKEN_KEY = 'environet.token'
const USER_KEY = 'environet.user'

export function getApiBase() {
  const raw = import.meta.env.VITE_API_URL
  if (raw == null || String(raw).trim() === '') return ''
  return String(raw).replace(/\/$/, '')
}

export function apiUrl(path) {
  const prefix = path.startsWith('/') ? path : `/${path}`
  return `${getApiBase()}${prefix}`
}

export function wsUrl() {
  const base = getApiBase()
  if (base) return `${base.replace(/^http/, 'ws')}/ws`
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

export function getStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getStoredUser() {
  try {
    const raw = window.localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function storeSession(token, user) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user))
    else window.localStorage.removeItem(USER_KEY)
  } catch {
    // ignore quota / private-mode failures
  }
}

export function clearSession() {
  storeSession(null, null)
}

async function request(path, { method = 'GET', body, auth = false, headers } = {}) {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 15_000)
  const nextHeaders = { Accept: 'application/json', ...headers }
  if (body !== undefined) nextHeaders['Content-Type'] = 'application/json'
  if (auth) {
    const token = getStoredToken()
    if (token) nextHeaders.Authorization = `Bearer ${token}`
  }

  try {
    const res = await fetch(apiUrl(path), {
      method,
      headers: nextHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const text = await res.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = { error: text }
      }
    }
    if (!res.ok) {
      const err = new Error(data?.error || `Request failed (${res.status})`)
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out — is the Environet API running?', { cause: err })
    }
    if (err instanceof TypeError) {
      throw new Error('Cannot reach Environet-BE. Start it with npm run backend.', { cause: err })
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

export const api = {
  health: () => request('/health'),
  dbHealth: () => request('/db/health'),
  ingestStatus: () => request('/ingest/status'),
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
  me: () => request('/api/auth/me', { auth: true }),
  sensors: () => request('/api/sensors'),
  nodes: () => request('/api/nodes'),
  node: (id) => request(`/api/nodes/${encodeURIComponent(id)}`),
  nodeHistory: (id, sensor, range) =>
    request(`/api/nodes/${encodeURIComponent(id)}/history?sensor=${encodeURIComponent(sensor)}&range=${encodeURIComponent(range)}`),
  nodeConfig: (id) => request(`/api/nodes/${encodeURIComponent(id)}/config`, { auth: true }),
  updateNodeConfig: (id, body) =>
    request(`/api/nodes/${encodeURIComponent(id)}/config`, { method: 'PUT', body, auth: true }),
  registerNode: (body) => request('/api/nodes', { method: 'POST', body, auth: true }),
  alerts: (params = {}) => {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== 'all') query.set(key, String(value))
    })
    const suffix = query.toString()
    return request(`/api/alerts${suffix ? `?${suffix}` : ''}`)
  },
  alert: (id) => request(`/api/alerts/${encodeURIComponent(id)}`),
  acknowledgeAlert: (id, note) =>
    request(`/api/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'PATCH', body: note ? { note } : {}, auth: true }),
  resolveAlert: (id, note) =>
    request(`/api/alerts/${encodeURIComponent(id)}/resolve`, { method: 'PATCH', body: note ? { note } : {}, auth: true }),
  escalateAlert: (id, note) =>
    request(`/api/alerts/${encodeURIComponent(id)}/escalate`, { method: 'PATCH', body: note ? { note } : {}, auth: true }),
  forecast: (node, hazard, horizon = 3) =>
    request(
      `/api/analytics/forecast?node=${encodeURIComponent(node)}&hazard=${encodeURIComponent(hazard)}&horizon=${horizon}`,
      { auth: true },
    ),
  users: () => request('/api/users', { auth: true }),
}

export const DEFAULT_AUTH = {
  username: import.meta.env.VITE_AUTH_USERNAME || 'admin',
  password: import.meta.env.VITE_AUTH_PASSWORD || 'admin123',
}
