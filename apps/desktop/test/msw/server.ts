import { setupServer } from 'msw/node'

/**
 * The shared MSW server used by every Vitest suite (wired in ./setup.ts).
 *
 * Deliberately starts with NO default handlers: each test declares exactly the
 * requests it needs through `server.use(...)`, and `onUnhandledRequest: 'error'`
 * turns any un-mocked request into a loud failure instead of a silent network
 * hit. This lives outside `src/` so it is never part of the app type-check or
 * bundle (AGENTS.md §6).
 */
export const server = setupServer()
