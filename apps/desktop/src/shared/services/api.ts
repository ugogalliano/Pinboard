import type { LoginResponse, ProblemDetails } from '../types/api'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './token'
import { notifySessionTerminated } from './session'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * Error thrown by `apiClient` for every non-OK HTTP response. `message` is
 * always the safe, status-mapped text — never a raw body or stack.
 */
export class ApiError extends Error {
  readonly status: number
  readonly problem: ProblemDetails

  constructor(status: number, problem: ProblemDetails) {
    super(mapApiErrorStatus(status, problem.detail))
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/**
 * Marker for a session that was obtained (tokens issued) but whose profile
 * load (GET /api/auth/me) then failed. Keeps forms from rendering a
 * login-step message ("Invalid email or password") for a profile failure —
 * callers distinguish the two phases by type (REVIEW fix 1).
 */
export class ProfileLoadError extends Error {
  /** The original cause (usually an ApiError). */
  readonly cause: unknown

  constructor(cause: unknown) {
    super(mapApiErrorToMessage(cause))
    this.name = 'ProfileLoadError'
    this.cause = cause
  }
}

export function isProfileLoadError(error: unknown): error is ProfileLoadError {
  return error instanceof ProfileLoadError
}

/** Status → safe toast message mapping (AGENTS.md §4). */
export function mapApiErrorStatus(status: number, detail?: string): string {
  switch (status) {
    case 400:
      return detail ? `Invalid input: ${detail}` : 'Invalid input'
    case 401:
      return 'Session expired, please log in again'
    case 403:
      return "You don't have permission for this action"
    case 404:
      return 'Resource not found'
    case 409:
      return 'This action conflicts with current state'
    default:
      return 'Something went wrong. Please try again.'
  }
}

/** Maps an error from a mutation/query to safe toast text. */
export function mapApiErrorToMessage(error: unknown): string {
  if (!isApiError(error)) {
    return mapApiErrorStatus(0)
  }
  return mapApiErrorStatus(error.status, error.problem.detail)
}

/**
 * Maps an ASP.NET ProblemDetails `errors` dictionary (PascalCase or dotted
 * keys like "Email"/"RegisterRequest.Email") to a VeeValidate field-error
 * record keyed by the lowercased final field name. Non-string/empty entries
 * are dropped so nothing unsafe reaches the form. A problem without an
 * errors dict maps to an empty record.
 */
export function mapProblemErrors(problem: ProblemDetails): Record<string, string> {
  const mapped: Record<string, string> = {}
  const errors = problem.errors
  if (!errors) {
    return mapped
  }
  for (const [key, messages] of Object.entries(errors)) {
    const field = key.toLowerCase().split('.').pop()
    const message = Array.isArray(messages) ? messages[0] : undefined
    if (field && message) {
      mapped[field] = message
    }
  }
  return mapped
}

/**
 * Normalizes an error response body into ProblemDetails without ever leaking
 * raw content into `message`: non-JSON / HTML proxy errors (e.g. a 502 from
 * the Vite proxy) get a synthesized problem carrying only safe, mapped text.
 */
function normalizeProblem(status: number, rawBody: string): ProblemDetails {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Trust the transport status over anything in the payload.
      return { ...(parsed as ProblemDetails), status }
    }
  } catch {
    // fall through to synthesized problem
  }
  return { status, title: 'Unexpected error', detail: mapApiErrorStatus(status) }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getAccessToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function request(method: HttpMethod, path: string, payload?: string): Promise<Response> {
  return fetch(path, {
    method,
    headers: buildHeaders(),
    body: payload,
  })
}

/**
 * Reads a response exactly once. 204 and empty bodies resolve to `undefined`
 * **before** any JSON parsing; non-OK responses become `ApiError`.
 */
async function handleResponse<T>(res: Response): Promise<T | undefined> {
  if (res.status === 204) {
    return undefined
  }

  const text = await res.text()

  if (!res.ok) {
    throw new ApiError(res.status, normalizeProblem(res.status, text))
  }

  if (text === '') {
    return undefined
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(res.status, { status: res.status })
  }
}

// ── 401 refresh (single-flight) ──────────────────────────────────────────
// api.ts must NEVER import authStore — the flow below goes through token.ts
// and the session.ts pub/sub bus only, so there is no module cycle. The
// backend rotates the refresh token. Every terminal refresh failure calls
// notifySessionTerminated() so the auth store can fully log out (user +
// query cache + toast) without api.ts importing app modules (SEC fix).

let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    clearTokens()
    notifySessionTerminated()
    return false
  }

  try {
    // Raw fetch: no Authorization header (the access token is the stale one).
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      clearTokens()
      notifySessionTerminated()
      return false
    }

    const data = (await res.json()) as Partial<LoginResponse>
    if (!data.accessToken || !data.refreshToken) {
      clearTokens()
      notifySessionTerminated()
      return false
    }

    setAccessToken(data.accessToken)
    setRefreshToken(data.refreshToken)
    return true
  } catch {
    clearTokens()
    notifySessionTerminated()
    return false
  }
}

function refreshInFlightShared(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

// ── Public client ────────────────────────────────────────────────────────

/**
 * Auth endpoints answer 401 themselves: on /api/auth/* a 401 is the endpoint's
 * verdict (invalid credentials, exhausted refresh…), NOT a stale-session
 * signal. Only GET /api/auth/me keeps the refresh+retry behaviour because it
 * is a plain "who am I" read that may hit an expired access token mid-session;
 * the auth flow refreshes explicitly everywhere else (PLAN.FE.md §5/§7).
 * Matching ignores any query string and is method-aware: POST /api/auth/me
 * (if such a variant ever exists) still skips, GET /api/auth/me?x=1 keeps it.
 */
export function shouldSkipAutoRefresh(method: HttpMethod, path: string): boolean {
  const pathname = path.split('?')[0] ?? path
  if (!pathname.startsWith('/api/auth/')) {
    return false
  }
  return !(method === 'GET' && pathname === '/api/auth/me')
}

/**
 * The single HTTP layer of the app. Called exclusively from Vue Query
 * `queryFn`/`mutationFn` in feature composables — never from components.
 * On 401 it refreshes the token (shared across concurrent callers) and
 * retries the original request exactly once. Auth paths (except
 * `/api/auth/me`) surface their 401 directly — see `shouldSkipAutoRefresh`.
 */
export async function apiClient<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  const payload = body === undefined ? undefined : JSON.stringify(body)

  const res = await request(method, path, payload)

  if (res.status === 401 && !shouldSkipAutoRefresh(method, path)) {
    const refreshed = await refreshInFlightShared()
    if (refreshed) {
      // Retry once; a second 401 is terminal (handleResponse throws, no loop).
      const retryRes = await request(method, path, payload)
      return handleResponse<T>(retryRes)
    }
  }

  return handleResponse<T>(res)
}
