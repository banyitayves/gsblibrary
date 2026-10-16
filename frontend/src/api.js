const API_URL = import.meta.env.VITE_API_URL || ''

export async function api(path, options = {}) {
  const token = sessionStorage.getItem('libraryflow-token')
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_URL}/api${path}`, { ...options, headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401 && token && path !== '/auth/login') {
      sessionStorage.removeItem('libraryflow-token')
      sessionStorage.removeItem('libraryflow-user')
      window.dispatchEvent(new Event('libraryflow:session-expired'))
    }
    throw new Error(payload.error || `Request failed (${response.status}).`)
  }
  if (response.status === 204) return null
  return response.json()
}
