import type { LoginResponse, ProblemDetails } from '../types/api'
import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from './token'

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
// only, so there is no module cycle. The backend rotates the refresh token.

let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    clearTokens()
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
      return false
    }

    const data = (await res.json()) as Partial<LoginResponse>
    if (!data.accessToken || !data.refreshToken) {
      clearTokens()
      return false
    }

    setAccessToken(data.accessToken)
    setRefreshToken(data.refreshToken)
    return true
  } catch {
    clearTokens()
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
 * The single HTTP layer of the app. Called exclusively from Vue Query
 * `queryFn`/`mutationFn` in feature composables — never from components.
 * On 401 it refreshes the token (shared across concurrent callers) and
 * retries the original request exactly once.
 */
export async function apiClient<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  const payload = body === undefined ? undefined : JSON.stringify(body)

  const res = await request(method, path, payload)

  if (res.status === 401) {
    const refreshed = await refreshInFlightShared()
    if (refreshed) {
      // Retry once; a second 401 is terminal (handleResponse throws, no loop).
      const retryRes = await request(method, path, payload)
      return handleResponse<T>(retryRes)
    }
  }

  return handleResponse<T>(res)
}
