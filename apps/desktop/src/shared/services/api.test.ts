import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  apiClient,
  isApiError,
  mapApiErrorStatus,
  mapApiErrorToMessage,
  mapProblemErrors,
} from './api'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './token'
import type { BoardDto, ProblemDetails } from '../types/api'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

// ── Response factories ───────────────────────────────────────────────────
// The client reads `res.text()` for normal responses and `res.json()` for the
// refresh call, so mocks expose both.

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  } as unknown as Response
}

function textResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => {
      throw new SyntaxError('not JSON')
    },
  } as unknown as Response
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => '',
    json: async () => {
      throw new SyntaxError('empty')
    },
  } as unknown as Response
}

interface FetchCall {
  url: string
  method?: string
  headers: Record<string, string>
  body?: string
}

function recordCall(url: string, init?: RequestInit): FetchCall {
  return {
    url,
    method: init?.method,
    headers: (init?.headers as Record<string, string>) ?? {},
    body: init?.body as string | undefined,
  }
}

const BOARDS: BoardDto[] = [
  { id: 'b1', name: 'Launch', createdBy: 'u1', createdAt: '', updatedAt: '' },
]

describe('apiClient', () => {
  let calls: FetchCall[]

  beforeEach(() => {
    localStorage.clear()
    clearTokens()
    calls = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function track(url: string, init?: RequestInit): FetchCall {
    const call = recordCall(url, init)
    calls.push(call)
    return call
  }

  function callsTo(url: string): FetchCall[] {
    return calls.filter((c) => c.url === url)
  }

  it('GET success parses typed JSON', async () => {
    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      track(url, init)
      return jsonResponse(200, BOARDS)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiClient<BoardDto[]>('GET', '/api/boards')

    expect(result).toEqual(BOARDS)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.body).toBeUndefined()
    expect(calls[0]!.headers['Content-Type']).toBe('application/json')
  })

  it('204 returns undefined before any JSON parsing', async () => {
    const res = emptyResponse(204)
    const jsonSpy = vi.spyOn(res, 'json')
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => res),
    )

    await expect(apiClient<void>('DELETE', '/api/boards/b1')).resolves.toBeUndefined()
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('200 with an empty body returns undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => emptyResponse(200)),
    )

    await expect(apiClient('GET', '/api/boards/b1')).resolves.toBeUndefined()
  })

  it('only serializes a body when one is provided', async () => {
    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      track(url, init)
      return jsonResponse(201, BOARDS[0])
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiClient('POST', '/api/boards', { name: 'Launch' })

    expect(calls[0]!.body).toBe(JSON.stringify({ name: 'Launch' }))
  })

  it('attaches Authorization when an access token exists and omits it otherwise', async () => {
    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      track(url, init)
      return jsonResponse(200, [])
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiClient('GET', '/api/boards')
    expect(calls[0]!.headers.Authorization).toBeUndefined()

    setAccessToken('tok-123')
    await apiClient('GET', '/api/boards')
    expect(calls[1]!.headers.Authorization).toBe('Bearer tok-123')
  })

  it('400 with ProblemDetails throws ApiError carrying the problem and the mapped message', async () => {
    const problem: ProblemDetails = {
      type: 'https://errors/postit/validation',
      title: 'One or more validation errors occurred.',
      status: 400,
      detail: 'Board name is required.',
      errors: { name: ['Name is required'] },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(400, problem)),
    )

    const error = await apiClient('POST', '/api/boards', { name: '' }).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    const apiError = error as ApiError
    expect(apiError.status).toBe(400)
    expect(apiError.problem.detail).toBe('Board name is required.')
    expect(apiError.problem.errors).toEqual({ name: ['Name is required'] })
    expect(apiError.message).toBe('Invalid input: Board name is required.')
  })

  it('502 with an HTML body synthesizes a safe ProblemDetails and leaks no raw HTML', async () => {
    const html =
      '<html><head><title>502 Bad Gateway</title></head><body>nginx internal secret</body></html>'
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => textResponse(502, html)),
    )

    const error = await apiClient('GET', '/api/boards').catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    const apiError = error as ApiError
    expect(apiError.status).toBe(502)
    expect(apiError.problem.title).toBe('Unexpected error')
    expect(apiError.problem.detail).toBe('Something went wrong. Please try again.')
    expect(apiError.message).toBe('Something went wrong. Please try again.')
    expect(apiError.message).not.toContain('nginx')
    expect(apiError.message).not.toContain('<html')
    expect(apiError.problem.detail).not.toContain('<html')
  })

  it('401 refreshes the token, rotates the refresh token and retries the original once', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        return jsonResponse(200, {
          accessToken: 'fresh',
          refreshToken: 'r2',
          expiresAt: '2026-01-01T00:00:00Z',
        })
      }
      if (callsTo('/api/boards').length === 1) {
        return jsonResponse(401, { status: 401, title: 'Unauthorized' })
      }
      return jsonResponse(200, BOARDS)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiClient<BoardDto[]>('GET', '/api/boards')

    expect(result).toEqual(BOARDS)
    expect(callsTo('/api/boards')).toHaveLength(2)

    // Refresh goes out WITHOUT the stale Authorization header and with the stored refresh token.
    const refreshCall = calls.find((c) => c.url === '/api/auth/refresh')!
    expect(refreshCall.headers.Authorization).toBeUndefined()
    expect(refreshCall.body).toBe(JSON.stringify({ refreshToken: 'r1' }))

    // The retry carries the rotated access token; tokens are updated everywhere.
    const retryCall = callsTo('/api/boards').at(-1)!
    expect(retryCall.headers.Authorization).toBe('Bearer fresh')
    expect(getAccessToken()).toBe('fresh')
    expect(getRefreshToken()).toBe('r2')
  })

  it('two concurrent 401s share a single refresh call (single-flight)', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    let refreshCalls = 0
    const firstAttempts = new Set<string>()
    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        refreshCalls += 1
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }
      if (!firstAttempts.has(call.url)) {
        firstAttempts.add(call.url)
        return jsonResponse(401, { status: 401, title: 'Unauthorized' })
      }
      return jsonResponse(200, BOARDS)
    })
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([
      apiClient<BoardDto[]>('GET', '/api/boards'),
      apiClient<BoardDto[]>('GET', '/api/boards/b1'),
    ])

    expect(a).toEqual(BOARDS)
    expect(b).toEqual(BOARDS)
    expect(refreshCalls).toBe(1)
    expect(callsTo('/api/boards')).toHaveLength(2)
    expect(callsTo('/api/boards/b1')).toHaveLength(2)
  })

  it('refresh failure clears tokens, throws the original 401 and never retries', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        return jsonResponse(401, { status: 401, title: 'Unauthorized' })
      }
      return jsonResponse(401, { status: 401, title: 'Unauthorized', detail: 'bad token' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const error = await apiClient('GET', '/api/boards').catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(callsTo('/api/boards')).toHaveLength(1) // original NOT retried
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
  })

  it('a second 401 after the retry is terminal (exactly one retry)', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }
      return jsonResponse(401, { status: 401, title: 'Unauthorized' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient('GET', '/api/boards')).rejects.toThrow(ApiError)
    expect(callsTo('/api/boards')).toHaveLength(2)
  })

  it('refresh returning 200 with an HTML/malformed body clears tokens and throws the terminal 401', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        // "successful" status but an HTML gateway page — res.json() must throw.
        return textResponse(200, '<html><body>proxy login page</body></html>')
      }
      return jsonResponse(401, { status: 401, title: 'Unauthorized' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const error = await apiClient('GET', '/api/boards').catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('postit.refreshToken')).toBeNull()
    // Refresh never succeeded, so the original request is NOT retried.
    expect(callsTo('/api/boards')).toHaveLength(1)
  })
  it('401 on /api/auth/login surfaces directly — NO refresh attempt', async () => {
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        // Would "succeed" if attempted — the point is it must never be called.
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }
      return jsonResponse(401, { status: 401, title: 'Unauthorized', detail: 'bad credentials' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const error = await apiClient('POST', '/api/auth/login', {
      email: 'a@b.co',
      password: 'wrong',
    }).catch((e: unknown) => e)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(401)
    expect(callsTo('/api/auth/login')).toHaveLength(1)
    expect(callsTo('/api/auth/refresh')).toHaveLength(0)
    // Tokens are untouched — a failed login must not clear the stored session.
    expect(getRefreshToken()).toBe('r1')
  })

  it('401 on /api/auth/register also skips the refresh cycle', async () => {
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }
      return jsonResponse(401, { status: 401 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient('POST', '/api/auth/register', { email: 'a@b.co' })).rejects.toThrow(
      ApiError,
    )
    expect(callsTo('/api/auth/refresh')).toHaveLength(0)
  })

  it('GET /api/auth/me keeps the refresh+retry cycle (stale access token mid-session)', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }
      if (callsTo('/api/auth/me').length === 1) {
        return jsonResponse(401, { status: 401, title: 'Unauthorized' })
      }
      return jsonResponse(200, { id: 'u1', email: 'a@b.co', displayName: 'Ada' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const me = await apiClient<{ id: string }>('GET', '/api/auth/me')

    expect(me).toEqual({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })
    expect(callsTo('/api/auth/refresh')).toHaveLength(1)
    expect(callsTo('/api/auth/me')).toHaveLength(2)
  })

  it('GET /api/auth/me?with-query keeps the refresh cycle (match ignores query string)', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }
      if (callsTo('/api/auth/me?fields=full').length === 1) {
        return jsonResponse(401, { status: 401, title: 'Unauthorized' })
      }
      return jsonResponse(200, { id: 'u1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient('GET', '/api/auth/me?fields=full')).resolves.toEqual({ id: 'u1' })
    expect(callsTo('/api/auth/refresh')).toHaveLength(1)
  })

  it('POST /api/auth/me (non-GET) skips the refresh cycle — exemption is GET-only', async () => {
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      track(url, init)
      if (url === '/api/auth/refresh') {
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }
      return jsonResponse(401, { status: 401, title: 'Unauthorized' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient('POST', '/api/auth/me')).rejects.toThrow(ApiError)
    expect(callsTo('/api/auth/refresh')).toHaveLength(0)
  })

  it('a terminal refresh failure notifies the session bus (full logout hook)', async () => {
    const { onSessionTerminated, clearSessionTerminatedHandlers } = await import('./session')
    setAccessToken('stale')
    setRefreshToken('r1')
    const handler = vi.fn<() => void>()
    onSessionTerminated(handler)

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        return jsonResponse(401, { status: 401, title: 'Unauthorized' })
      }
      return jsonResponse(401, { status: 401, title: 'Unauthorized' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient('GET', '/api/boards')).rejects.toThrow(ApiError)
    expect(handler).toHaveBeenCalledTimes(1)
    clearSessionTerminatedHandlers()
  })

  it('a normal (non-auth) endpoint still refreshes and retries on 401', async () => {
    setAccessToken('stale')
    setRefreshToken('r1')

    const fetchMock = vi.fn<FetchImpl>(async (url, init) => {
      const call = track(url, init)
      if (call.url === '/api/auth/refresh') {
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'r2', expiresAt: '' })
      }
      if (callsTo('/api/boards').length === 1) {
        return jsonResponse(401, { status: 401, title: 'Unauthorized' })
      }
      return jsonResponse(200, BOARDS)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient<BoardDto[]>('GET', '/api/boards')).resolves.toEqual(BOARDS)
    expect(callsTo('/api/auth/refresh')).toHaveLength(1)
  })
})

describe('mapProblemErrors', () => {
  it('lowercases PascalCase/dotted keys to field names and keeps the first message', () => {
    expect(
      mapProblemErrors({
        status: 400,
        errors: {
          Email: ['Email is already taken', 'second'],
          'RegisterRequest.Password': ['Password is too short'],
        },
      }),
    ).toEqual({
      email: 'Email is already taken',
      password: 'Password is too short',
    })
  })

  it('drops entries without a usable message', () => {
    expect(mapProblemErrors({ status: 400, errors: { Name: [] } })).toEqual({})
  })

  it('returns an empty record when the problem has no errors dict', () => {
    expect(mapProblemErrors({ status: 400, detail: 'Invalid input' })).toEqual({})
  })
})

describe('mapApiErrorStatus', () => {
  it('implements the AGENTS.md §4 table', () => {
    expect(mapApiErrorStatus(400, 'Name too long')).toBe('Invalid input: Name too long')
    expect(mapApiErrorStatus(400)).toBe('Invalid input')
    expect(mapApiErrorStatus(401)).toBe('Session expired, please log in again')
    expect(mapApiErrorStatus(403)).toBe("You don't have permission for this action")
    expect(mapApiErrorStatus(404)).toBe('Resource not found')
    expect(mapApiErrorStatus(409)).toBe('This action conflicts with current state')
    expect(mapApiErrorStatus(500)).toBe('Something went wrong. Please try again.')
    expect(mapApiErrorStatus(503)).toBe('Something went wrong. Please try again.')
  })

  it('maps 401 detail to the safe generic text (detail never leaks for auth statuses)', () => {
    expect(mapApiErrorStatus(401, 'raw token rejected because xyz')).toBe(
      'Session expired, please log in again',
    )
  })
})

describe('mapApiErrorToMessage', () => {
  it('falls back to the generic status-0 message for non-ApiError input', () => {
    expect(mapApiErrorToMessage(new Error('network down'))).toBe(
      'Something went wrong. Please try again.',
    )
    expect(mapApiErrorToMessage('a string')).toBe('Something went wrong. Please try again.')
    expect(mapApiErrorToMessage(undefined)).toBe('Something went wrong. Please try again.')
  })
})
