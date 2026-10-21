import { ref, type Ref } from 'vue'
import { HubConnectionBuilder, HubConnectionState, type HubConnection } from '@microsoft/signalr'

import type { NoteDto } from '../types/api'
import { API_URLS } from '../constants/urls'
import { getAccessToken } from './token'
import { onSessionTerminated } from './session'

// Board hub transport (PLAN.FE.md Phase 7). UI-free singleton: it owns the
// SignalR connection, the joined-board set and a callback registry. It never
// touches the query cache or stores — cache wiring lives in feature
// composables (later task), and the token comes from token.ts ONLY (the
// module-cycle rule of api.ts applies here too: never import authStore).

/** Reactive board-hub connection state (mirrors the SignalR lifecycle). */
export type BoardConnectionState = 'Disconnected' | 'Connecting' | 'Connected' | 'Reconnecting'

export type NoteCreatedListener = (note: NoteDto) => void
export type NoteUpdatedListener = (note: NoteDto) => void
export type NoteDeletedListener = (noteId: string) => void

// Server → client event names, verified against apps/server BoardHub /
// BoardNotificationService.cs (payloads: full NoteDto / full NoteDto / noteId).
const SERVER_EVENTS = {
  created: 'PostItCreated',
  updated: 'PostItUpdated',
  deleted: 'PostItDeleted',
} as const

// Client → server hub methods, verified against apps/server BoardHub.cs.
const HUB_METHODS = {
  join: 'JoinBoard',
  leave: 'LeaveBoard',
} as const

const boardConnectionStateInternal = ref<BoardConnectionState>('Disconnected')

/**
 * Module-level readonly connection state, driven by the SignalR lifecycle
 * (start → Connecting, start resolves → Connected, onreconnecting →
 * Reconnecting, onreconnected → Connected, onclose → Disconnected).
 */
export const boardConnectionState: Readonly<Ref<BoardConnectionState>> =
  boardConnectionStateInternal

// Listener lifetime is INDEPENDENT of connection lifetime: a single `.on(...)`
// per server event is registered on each (re)built connection and dispatches
// into these module-level registries, so subscribers never lose handlers to
// transport churn (rebuild, reconnect, stop + connect).
const noteCreatedListeners = new Set<NoteCreatedListener>()
const noteUpdatedListeners = new Set<NoteUpdatedListener>()
const noteDeletedListeners = new Set<NoteDeletedListener>()

// Boards we must be subscribed to, independent of the connection: joined on
// first open, re-joined on every (re)connect, cleared only by leaveBoard or
// stopBoardHub. Server groups are bound to the SignalR connection, so every
// fresh or re-established connection must re-invoke JoinBoard for all of them.
const joinedBoards = new Set<string>()

let connection: HubConnection | null = null

function buildConnection(): HubConnection {
  const conn = new HubConnectionBuilder()
    // Relative hub URL (the Vite proxy forwards /hubs with ws:true). JWT is
    // passed by the library as ?access_token= — never log URLs (AGENTS.md §7).
    .withUrl(API_URLS.hub.board, {
      accessTokenFactory: () => getAccessToken() ?? '',
    })
    // Default incremental backoff policy.
    .withAutomaticReconnect()
    .build()

  conn.onclose(() => {
    // Also covers a failed start(): a connection that never opened or that
    // dropped terminal resets the reactive state.
    if (connection === conn) {
      boardConnectionStateInternal.value = 'Disconnected'
    }
  })

  conn.onreconnecting(() => {
    if (connection === conn) {
      boardConnectionStateInternal.value = 'Reconnecting'
    }
  })

  conn.onreconnected(() => {
    if (connection !== conn) {
      return
    }
    boardConnectionStateInternal.value = 'Connected'
    // RE-JOIN RULE: the server groups died with the old connection.
    rejoinAll(conn)
  })

  // One registration per server event, dispatching to the module registry.
  conn.on(SERVER_EVENTS.created, (note: NoteDto) => {
    for (const listener of noteCreatedListeners) {
      listener(note)
    }
  })
  conn.on(SERVER_EVENTS.updated, (note: NoteDto) => {
    for (const listener of noteUpdatedListeners) {
      listener(note)
    }
  })
  conn.on(SERVER_EVENTS.deleted, (noteId: string) => {
    for (const listener of noteDeletedListeners) {
      listener(noteId)
    }
  })

  return conn
}

function rejoinAll(conn: HubConnection): void {
  for (const boardId of joinedBoards) {
    conn.invoke(HUB_METHODS.join, boardId).catch(() => {
      // The board stays in the joined-set, so the next reconnect retries it.
      // Transport stays UI-free — no toast here.
    })
  }
}

/**
 * Starts the board hub. Idempotent: no-op while Connecting/Connected/
 * Reconnecting; rebuilds and starts only from Disconnected. A failed start
 * leaves state consistent (Disconnected) and rethrows — never swallowed.
 */
export async function connectBoardHub(): Promise<void> {
  if (boardConnectionStateInternal.value !== 'Disconnected') {
    return
  }

  const conn = buildConnection()
  connection = conn
  boardConnectionStateInternal.value = 'Connecting'

  try {
    await conn.start()
  } catch (error) {
    if (connection === conn) {
      connection = null
      boardConnectionStateInternal.value = 'Disconnected'
    }
    throw error
  }

  // The connected event for the FIRST open is start() resolving (the JS client
  // has no onconnected callback); stop() during the await discards this one.
  if (connection === conn) {
    boardConnectionStateInternal.value = 'Connected'
    // Flush boards joined before the connection opened (same rejoin rule).
    rejoinAll(conn)
  }
}

/**
 * Subscribes to a board: records the boardId and invokes `JoinBoard` when the
 * connection is up; while not yet connected the board is joined automatically
 * when the connection opens (or re-opens).
 */
export async function joinBoard(boardId: string): Promise<void> {
  joinedBoards.add(boardId)
  if (!connection || connection.state !== HubConnectionState.Connected) {
    return
  }
  await connection.invoke(HUB_METHODS.join, boardId)
}

/** Unsubscribes from a board: removes it from the joined-set (so reconnects
 *  no longer rejoin it) and invokes `LeaveBoard` when the connection is up. */
export async function leaveBoard(boardId: string): Promise<void> {
  joinedBoards.delete(boardId)
  if (!connection || connection.state !== HubConnectionState.Connected) {
    return
  }
  await connection.invoke(HUB_METHODS.leave, boardId)
}

/**
 * Stops the connection, clears the joined-set and resets state to
 * Disconnected. Idempotent and never rejects (stop errors are best-effort:
 * the transport must always converge to Disconnected) — safe to await from
 * logout. Event-listener registries survive on purpose (independent lifetime).
 */
export async function stopBoardHub(): Promise<void> {
  const conn = connection
  // Drop the reference FIRST: late lifecycle events from the old connection
  // are then ignored by the handlers above.
  connection = null
  joinedBoards.clear()
  if (conn) {
    try {
      await conn.stop()
    } catch {
      // Best-effort stop; the local state reset below is what matters.
    }
  }
  boardConnectionStateInternal.value = 'Disconnected'
}

export function onNoteCreated(listener: NoteCreatedListener): void {
  noteCreatedListeners.add(listener)
}

export function offNoteCreated(listener: NoteCreatedListener): void {
  noteCreatedListeners.delete(listener)
}

export function onNoteUpdated(listener: NoteUpdatedListener): void {
  noteUpdatedListeners.add(listener)
}

export function offNoteUpdated(listener: NoteUpdatedListener): void {
  noteUpdatedListeners.delete(listener)
}

export function onNoteDeleted(listener: NoteDeletedListener): void {
  noteDeletedListeners.add(listener)
}

export function offNoteDeleted(listener: NoteDeletedListener): void {
  noteDeletedListeners.delete(listener)
}

// SESSION LOSS RULE: terminal session loss must drop the live connection.
// Registered at module load, mirroring how authStore hooks the bus (session.ts
// imports nothing, so there is no cycle). stopBoardHub is idempotent, so a
// duplicate registration (e.g. HMR) is harmless; tests clear the bus via
// clearSessionTerminatedHandlers().
onSessionTerminated(() => {
  void stopBoardHub()
})
