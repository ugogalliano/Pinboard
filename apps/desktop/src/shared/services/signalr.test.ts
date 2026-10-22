import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { NoteDto } from '../types/api'
import { API_URLS } from '../constants/urls'
import { clearTokens, setAccessToken } from './token'
import { notifySessionTerminated } from './session'
import {
  boardConnectionState,
  connectBoardHub,
  joinBoard,
  leaveBoard,
  offNoteCreated,
  offNoteDeleted,
  offNoteUpdated,
  onNoteCreated,
  onNoteDeleted,
  onNoteUpdated,
  stopBoardHub,
} from './signalr'

// ── Mocked @microsoft/signalr (no real network — AGENTS.md §6) ───────────
// The builder chain and the connection are fakes that capture every lifecycle
// registration (`onclose`/`onreconnecting`/`onreconnected`), every hub-event
// `on(...)` handler and every `invoke`/`start`/`stop` call, so the tests can
// simulate the full connection choreography by hand.

interface MockSignalRConnection {
  url: string
  options?: { accessTokenFactory?: () => string | Promise<string> }
  usesAutomaticReconnect: boolean
  state: string
  serverHandlers: Map<string, (payload: unknown) => void>
  closeCallbacks: Array<(error?: Error) => void>
  reconnectingCallbacks: Array<(error?: Error) => void>
  reconnectedCallbacks: Array<(connectionId?: string) => void>
  invoke: Mock<(method: string, ...args: unknown[]) => Promise<void>>
  start: Mock<() => Promise<void>>
  stop: Mock<() => Promise<void>>
}

const signalRMock = vi.hoisted(() => ({
  connections: [] as unknown[],
  failNextStart: false,
}))

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Connected: 'Connected',
    Disconnecting: 'Disconnecting',
    Reconnecting: 'Reconnecting',
  }

  class MockHubConnection {
    url: string
    options?: { accessTokenFactory?: () => string | Promise<string> }
    usesAutomaticReconnect: boolean
    state: string = HubConnectionState.Disconnected
    serverHandlers = new Map<string, (payload: unknown) => void>()
    closeCallbacks: Array<(error?: Error) => void> = []
    reconnectingCallbacks: Array<(error?: Error) => void> = []
    reconnectedCallbacks: Array<(connectionId?: string) => void> = []

    invoke = vi.fn<(method: string, ...args: unknown[]) => Promise<void>>(async () => undefined)
    start = vi.fn<() => Promise<void>>(async (): Promise<void> => {
      if (signalRMock.failNextStart) {
        signalRMock.failNextStart = false
        this.state = HubConnectionState.Disconnected
        throw new Error('mock start failed')
      }
      this.state = HubConnectionState.Connected
    })
    stop = vi.fn<() => Promise<void>>(async (): Promise<void> => {
      this.state = HubConnectionState.Disconnected
      for (const cb of this.closeCallbacks.slice()) {
        cb()
      }
    })

    constructor(
      url: string,
      options: { accessTokenFactory?: () => string | Promise<string> } | undefined,
      usesAutomaticReconnect: boolean,
    ) {
      this.url = url
      this.options = options
      this.usesAutomaticReconnect = usesAutomaticReconnect
    }

    on(methodName: string, handler: (payload: unknown) => void): void {
      this.serverHandlers.set(methodName, handler)
    }

    onclose(callback: (error?: Error) => void): void {
      this.closeCallbacks.push(callback)
    }

    onreconnecting(callback: (error?: Error) => void): void {
      this.reconnectingCallbacks.push(callback)
    }

    onreconnected(callback: (connectionId?: string) => void): void {
      this.reconnectedCallbacks.push(callback)
    }
  }

  class MockHubConnectionBuilder {
    private url = ''
    private options?: { accessTokenFactory?: () => string | Promise<string> }
    private autoReconnect = false

    withUrl(
      url: string,
      options?: { accessTokenFactory?: () => string | Promise<string> },
    ): this {
      this.url = url
      this.options = options
      return this
    }

    withAutomaticReconnect(): this {
      this.autoReconnect = true
      return this
    }

    build(): MockSignalRConnection {
      const conn = new MockHubConnection(this.url, this.options, this.autoReconnect)
      signalRMock.connections.push(conn)
      return conn as unknown as MockSignalRConnection
    }
  }

  return { HubConnectionBuilder: MockHubConnectionBuilder, HubConnectionState }
})

// ── Simulation helpers ────────────────────────────────────────────────────

function lastConnection(): MockSignalRConnection {
  const conn = signalRMock.connections[signalRMock.connections.length - 1]
  if (!conn) {
    throw new Error('expected a hub connection to have been built')
  }
  return conn as MockSignalRConnection
}

function joinInvocations(conn: MockSignalRConnection): string[] {
  return conn.invoke.mock.calls
    .filter((call) => call[0] === 'JoinBoard')
    .map((call) => call[1] as string)
}

function fireReconnecting(conn: MockSignalRConnection): void {
  conn.state = 'Reconnecting'
  for (const cb of conn.reconnectingCallbacks.slice()) {
    cb()
  }
}

function fireReconnected(conn: MockSignalRConnection): void {
  conn.state = 'Connected'
  for (const cb of conn.reconnectedCallbacks.slice()) {
    cb('reconnected')
  }
}

function fireClose(conn: MockSignalRConnection): void {
  conn.state = 'Disconnected'
  for (const cb of conn.closeCallbacks.slice()) {
    cb()
  }
}

function emit(conn: MockSignalRConnection, event: string, payload: unknown): void {
  const handler = conn.serverHandlers.get(event)
  if (!handler) {
    throw new Error(`no handler registered for server event '${event}'`)
  }
  handler(payload)
}

const NOTE: NoteDto = {
  id: 'n1',
  boardId: 'b1',
  createdBy: 'u1',
  content: 'hello',
  color: 'amber',
  positionX: 10,
  positionY: 20,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
}

describe('BoardSignalRService (signalr.ts)', () => {
  beforeEach(() => {
    clearTokens()
  })

  afterEach(async () => {
    // Return the module singleton to a clean slate for the next test.
    await stopBoardHub()
    signalRMock.connections.length = 0
    signalRMock.failNextStart = false
  })

  it('connectBoardHub is idempotent: concurrent and repeat calls build one connection', async () => {
    await Promise.all([connectBoardHub(), connectBoardHub()])
    await connectBoardHub()

    expect(signalRMock.connections).toHaveLength(1)
    expect(boardConnectionState.value).toBe('Connected')
  })

  it('drives state through the lifecycle: Connecting → Connected → Reconnecting → Connected → Disconnected', async () => {
    const pending = connectBoardHub()
    expect(boardConnectionState.value).toBe('Connecting')

    await pending
    expect(boardConnectionState.value).toBe('Connected')

    const conn = lastConnection()
    fireReconnecting(conn)
    expect(boardConnectionState.value).toBe('Reconnecting')

    fireReconnected(conn)
    expect(boardConnectionState.value).toBe('Connected')

    fireClose(conn)
    expect(boardConnectionState.value).toBe('Disconnected')
  })

  it('a failed start leaves state Disconnected and does not swallow the error', async () => {
    signalRMock.failNextStart = true

    await expect(connectBoardHub()).rejects.toThrow('mock start failed')
    expect(boardConnectionState.value).toBe('Disconnected')

    // Transport stays usable: a later connect rebuilds and succeeds.
    await connectBoardHub()
    expect(boardConnectionState.value).toBe('Connected')
  })

  it('joinBoard before connect records the board and flushes it on the first open', async () => {
    await joinBoard('b1')
    expect(signalRMock.connections).toHaveLength(0)

    await connectBoardHub()
    expect(joinInvocations(lastConnection())).toEqual(['b1'])
  })

  it('joinBoard invokes JoinBoard directly while connected', async () => {
    await connectBoardHub()
    const conn = lastConnection()

    await joinBoard('b2')
    expect(conn.invoke).toHaveBeenCalledWith('JoinBoard', 'b2')
  })

  it('re-invokes JoinBoard for every joined board on reconnected', async () => {
    await connectBoardHub()
    const conn = lastConnection()
    await joinBoard('b1')
    await joinBoard('b2')
    expect(joinInvocations(conn)).toEqual(['b1', 'b2'])

    fireReconnecting(conn)
    fireReconnected(conn)
    expect(joinInvocations(conn)).toEqual(['b1', 'b2', 'b1', 'b2'])
  })

  it('leaveBoard invokes LeaveBoard and removes the board from the rejoin set', async () => {
    await connectBoardHub()
    const conn = lastConnection()
    await joinBoard('b1')
    await joinBoard('b2')

    await leaveBoard('b1')
    expect(conn.invoke).toHaveBeenCalledWith('LeaveBoard', 'b1')

    fireReconnecting(conn)
    fireReconnected(conn)
    expect(joinInvocations(conn)).toEqual(['b1', 'b2', 'b2'])
  })

  it('stopBoardHub stops the connection, clears state and the joined set, and is idempotent', async () => {
    await connectBoardHub()
    const first = lastConnection()
    await joinBoard('b1')

    await stopBoardHub()
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(boardConnectionState.value).toBe('Disconnected')

    // Idempotent: stopping again is a no-op, never rejects.
    await stopBoardHub()

    // Reconnect rebuilds from scratch with an empty joined-set.
    await connectBoardHub()
    const second = lastConnection()
    expect(second).not.toBe(first)
    expect(joinInvocations(second)).toEqual([])
  })

  it('single on() registrations dispatch to multiple callbacks; off() unsubscribes', async () => {
    const createdA = vi.fn<(note: NoteDto) => void>()
    const createdB = vi.fn<(note: NoteDto) => void>()
    const updated = vi.fn<(note: NoteDto) => void>()
    const deleted = vi.fn<(noteId: string) => void>()
    onNoteCreated(createdA)
    onNoteCreated(createdB)
    onNoteUpdated(updated)
    onNoteDeleted(deleted)

    await connectBoardHub()
    const conn = lastConnection()
    // Exactly one hub registration per server event, whatever the callback count.
    expect(conn.serverHandlers.size).toBe(3)

    emit(conn, 'PostItCreated', NOTE)
    expect(createdA).toHaveBeenCalledWith(NOTE)
    expect(createdB).toHaveBeenCalledWith(NOTE)

    offNoteCreated(createdA)
    emit(conn, 'PostItCreated', NOTE)
    expect(createdA).toHaveBeenCalledTimes(1)
    expect(createdB).toHaveBeenCalledTimes(2)

    emit(conn, 'PostItUpdated', NOTE)
    expect(updated).toHaveBeenCalledWith(NOTE)
    emit(conn, 'PostItDeleted', 'n9')
    expect(deleted).toHaveBeenCalledWith('n9')

    offNoteUpdated(updated)
    offNoteDeleted(deleted)
    emit(conn, 'PostItUpdated', NOTE)
    emit(conn, 'PostItDeleted', 'n9')
    expect(updated).toHaveBeenCalledTimes(1)
    expect(deleted).toHaveBeenCalledTimes(1)
  })

  it('listeners survive transport churn (stop + fresh connect)', async () => {
    const created = vi.fn<(note: NoteDto) => void>()
    onNoteCreated(created)

    await connectBoardHub()
    await stopBoardHub()
    await connectBoardHub()

    emit(lastConnection(), 'PostItCreated', NOTE)
    expect(created).toHaveBeenCalledWith(NOTE)

    offNoteCreated(created)
  })

  it('a stopped/replaced connection cannot dispatch into the listener registry', async () => {
    const created = vi.fn<(note: NoteDto) => void>()
    onNoteCreated(created)

    await connectBoardHub()
    const dying = lastConnection()

    await stopBoardHub()
    await connectBoardHub()

    // Late frame from the OLD socket must be ignored (staleness guard).
    emit(dying, 'PostItCreated', NOTE)
    expect(created).not.toHaveBeenCalled()

    offNoteCreated(created)
  })

  it('a late onclose from a replaced connection does not clobber the live state', async () => {
    await connectBoardHub()
    const first = lastConnection()

    await stopBoardHub()
    await connectBoardHub()

    expect(boardConnectionState.value).toBe('Connected')

    // The old connection's terminal close event arrives late: inert.
    fireClose(first)
    expect(boardConnectionState.value).toBe('Connected')

    // The LIVE connection's close still drives the state.
    fireClose(lastConnection())
    expect(boardConnectionState.value).toBe('Disconnected')
  })

  it('a throwing listener is isolated: later listeners still get the payload', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const boom = vi.fn<(note: NoteDto) => void>(() => {
      throw new Error('listener bug')
    })
    const good = vi.fn<(note: NoteDto) => void>()
    onNoteCreated(boom)
    onNoteCreated(good)

    await connectBoardHub()
    // The dispatch must not throw into the SignalR pipeline.
    expect(() => emit(lastConnection(), 'PostItCreated', NOTE)).not.toThrow()

    expect(boom).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledWith(NOTE)
    // Stable internal marker only — never payload/error detail (AGENTS §7).
    expect(debugSpy).toHaveBeenCalledTimes(1)
    for (const call of debugSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('listener bug')
      expect(JSON.stringify(call)).not.toContain('hello')
    }

    offNoteCreated(boom)
    offNoteCreated(good)
    debugSpy.mockRestore()
  })

  it('terminal session loss on the session bus drops the live connection', async () => {
    await connectBoardHub()
    const conn = lastConnection()

    notifySessionTerminated()

    await vi.waitFor(() => {
      expect(conn.stop).toHaveBeenCalledTimes(1)
    })
    expect(boardConnectionState.value).toBe('Disconnected')
    expect(joinInvocations(conn)).toEqual([])
  })

  it('builds on the board hub URL with automatic reconnect and a token.ts-backed accessTokenFactory', async () => {
    setAccessToken('tok-42')
    await connectBoardHub()
    const conn = lastConnection()

    expect(conn.url).toBe(API_URLS.hub.board)
    expect(conn.usesAutomaticReconnect).toBe(true)
    expect(conn.options?.accessTokenFactory?.()).toBe('tok-42')

    // The factory reads token.ts at call time; no token → empty string.
    clearTokens()
    expect(conn.options?.accessTokenFactory?.()).toBe('')
  })

  // ── Recovery watchdog (final Phase 7 review ruling) ───────────────────
  describe('watchdog retry after terminal failure', () => {
    // The ruling pins a slow (30s) single-timer retry while connect intent
    // stands. Fake timers make the wait observable without real delays.
    const RETRY_DELAY_MS = 30_000

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('a terminal close re-attempts after the slow delay and re-joins the pending boards', async () => {
      await connectBoardHub()
      const first = lastConnection()
      await joinBoard('b1')

      // Automatic reconnect exhausted → terminal onclose.
      fireClose(first)
      expect(boardConnectionState.value).toBe('Disconnected')

      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)

      // Watchdog called connectBoardHub(): fresh connection, joined-set
      // flushed on open by the existing rejoin machinery.
      expect(signalRMock.connections).toHaveLength(2)
      expect(boardConnectionState.value).toBe('Connected')
      expect(joinInvocations(lastConnection())).toEqual(['b1'])
    })

    it('stopBoardHub clears the intent and cancels a pending watchdog retry', async () => {
      await connectBoardHub()
      const first = lastConnection()
      fireClose(first) // watchdog armed

      await stopBoardHub() // intent OFF, timer cleared

      await vi.advanceTimersByTimeAsync(4 * RETRY_DELAY_MS)
      expect(signalRMock.connections).toHaveLength(1)
      expect(boardConnectionState.value).toBe('Disconnected')
    })

    it('a failed initial start arms the watchdog and a later tick connects', async () => {
      signalRMock.failNextStart = true
      await expect(connectBoardHub()).rejects.toThrow('mock start failed')
      expect(signalRMock.connections).toHaveLength(1)
      expect(boardConnectionState.value).toBe('Disconnected')

      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)

      expect(signalRMock.connections).toHaveLength(2)
      expect(boardConnectionState.value).toBe('Connected')
    })

    it('the online event attempts immediately and never double-schedules', async () => {
      await connectBoardHub()
      const first = lastConnection()
      fireClose(first) // slow watchdog pending

      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0) // let the immediate attempt resolve

      expect(signalRMock.connections).toHaveLength(2)
      expect(boardConnectionState.value).toBe('Connected')

      // The pending slow timer was cancelled: no churn after the window.
      await vi.advanceTimersByTimeAsync(4 * RETRY_DELAY_MS)
      expect(signalRMock.connections).toHaveLength(2)
    })
  })
})
