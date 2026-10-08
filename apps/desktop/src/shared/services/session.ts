// Tiny pub/sub for terminal session loss (SEC fix, Phase 3 review).
//
// api.ts cannot import authStore (module cycle — AGENTS.md §5), but a failed
// mid-session refresh must fully log the user out *immediately* (user state,
// query cache, toast), not lazily on next navigation. api.ts calls
// notifySessionTerminated() at every terminal refresh failure; the auth store
// registers the handler at store creation and performs the cleanup.
// This module depends on nothing — no cycles by construction.
export type SessionTerminatedHandler = () => void

const handlers: SessionTerminatedHandler[] = []

/** Registers a handler. Registering the same function twice is a no-op. */
export function onSessionTerminated(handler: SessionTerminatedHandler): void {
  if (!handlers.includes(handler)) {
    handlers.push(handler)
  }
}

/** Test seam: drop all handlers (each test file owns a fresh Pinia). */
export function clearSessionTerminatedHandlers(): void {
  handlers.length = 0
}

/** Invokes every handler. Handlers must be idempotent (double clear is safe). */
export function notifySessionTerminated(): void {
  // Iterate a snapshot: a handler may register/clear handlers reentrantly.
  for (const handler of handlers.slice()) {
    handler()
  }
}
