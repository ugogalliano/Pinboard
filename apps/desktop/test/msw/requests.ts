import { server } from './server'

export interface RecordedRequest {
  method: string
  url: string
}

/**
 * Every request MSW observed, in the order it was sent, normalized to
 * `{ method, url }` where `url` is the path + query (origin stripped) — so
 * assertions can compare against the same relative paths the app calls.
 *
 * RULE: never read `request.body` / `request.json()` inside a life-cycle
 * listener — MSW locks the request stream there and the handler would then see
 * an empty body. Bodies and the Authorization header are captured inside the
 * handler closure instead (AGENTS.md §6).
 */
export const requestLog: RecordedRequest[] = []

// Registered as a module side effect. Safe because Vitest isolates the module
// registry per test file, so each file gets its own listener exactly once; it
// would stack duplicate listeners if `isolate: false` were ever enabled.
server.events.on('request:start', ({ request }) => {
  const { pathname, search } = new URL(request.url)
  requestLog.push({ method: request.method, url: `${pathname}${search}` })
})

/**
 * Observed requests whose path + query equals `path`. Pass `method` (e.g.
 * `'POST'`) to narrow further — needed where one path serves more than one verb
 * (`/api/boards` is both GET and POST); omit it to match any method.
 */
export function callsTo(path: string, method?: string): RecordedRequest[] {
  return requestLog.filter(
    (entry) => entry.url === path && (method === undefined || entry.method === method),
  )
}

/** Clears the log — called from the afterEach hook in ./setup.ts. */
export function resetRequestLog(): void {
  requestLog.length = 0
}
