/**
 * Centralised API client.
 *
 * Everything that talks to the backend goes through here — base URL, bearer
 * token, error shape and 401 handling live in one place rather than being
 * scattered across components.
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

const TOKEN_KEY = 'arogya.token'

/** The error envelope every backend failure returns. */
export interface ApiErrorBody {
  detail: string
  code?: string
  errors?: unknown
  reference?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly reference?: string
  readonly body?: ApiErrorBody

  constructor(status: number, body?: ApiErrorBody, fallback = 'Something went wrong.') {
    super(body?.detail ?? fallback)
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code
    this.reference = body?.reference
    this.body = body
  }

  /** True when the session is gone and the user has to sign in again. */
  get isAuthError() {
    return this.status === 401
  }

  get isForbidden() {
    return this.status === 403
  }
}

/* -------------------------------------------------------------------------- */
/* Token storage                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors the existing "remember me" behaviour: localStorage when remembered,
 * sessionStorage otherwise. sessionStorage is read first so a per-tab sign-in
 * wins over a remembered one.
 */
export const tokenStore = {
  get(): string | null {
    try {
      return window.sessionStorage.getItem(TOKEN_KEY) ?? window.localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },

  set(token: string, remember: boolean) {
    try {
      const store = remember ? window.localStorage : window.sessionStorage
      const other = remember ? window.sessionStorage : window.localStorage
      store.setItem(TOKEN_KEY, token)
      other.removeItem(TOKEN_KEY)
    } catch {
      /* storage unavailable (private mode) — the session stays in memory */
    }
  },

  clear() {
    try {
      window.localStorage.removeItem(TOKEN_KEY)
      window.sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  },
}

/* -------------------------------------------------------------------------- */
/* Unauthorised handling                                                      */
/* -------------------------------------------------------------------------- */

type UnauthorizedHandler = () => void

let onUnauthorized: UnauthorizedHandler | null = null

/**
 * Registered once by AuthContext. When any request comes back 401 the session
 * is cleared and the user is sent to /login — an expired token is never
 * silently reused.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler
}

/* -------------------------------------------------------------------------- */
/* Request                                                                    */
/* -------------------------------------------------------------------------- */

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** Skip the Authorization header (used by login). */
  anonymous?: boolean
  /** Do not trigger the global 401 handler (used when probing a token). */
  suppressAuthRedirect?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, anonymous, suppressAuthRedirect, headers, ...init } = options

  const isForm = body instanceof FormData
  const requestHeaders = new Headers(headers)
  // FormData sets its own Content-Type, boundary included. Setting one here
  // would produce a header the server cannot parse the body against.
  if (body !== undefined && !isForm && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json')
  }
  if (!anonymous) {
    const token = tokenStore.get()
    if (token) requestHeaders.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: requestHeaders,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    })
  } catch {
    // Network-level failure: the server is unreachable, not returning an error.
    throw new ApiError(0, { detail: 'Cannot reach the server. Check that the API is running.' })
  }

  if (response.status === 401 && !suppressAuthRedirect) {
    onUnauthorized?.()
  }

  if (response.status === 204) {
    return undefined as T
  }

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json().catch(() => undefined) : undefined

  if (!response.ok) {
    throw new ApiError(response.status, payload as ApiErrorBody, response.statusText)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  /** Multipart POST, for file uploads. Same auth and error handling as the rest. */
  upload: <T>(path: string, form: FormData, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body: form }),
}

export { BASE_URL }
