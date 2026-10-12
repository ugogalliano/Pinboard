import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'
import { resetRequestLog } from './requests'

/**
 * Vitest lifecycle for the shared MSW server (registered through
 * `test.setupFiles` in vitest.config.ts).
 *
 * `onUnhandledRequest: 'error'` is mandatory: a request no handler answers must
 * fail the test loudly instead of reaching the real network. Handlers declared
 * per test through `server.use(...)` are dropped after every test, and the
 * request log is cleared alongside them.
 */
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
  resetRequestLog()
})

afterAll(() => {
  server.close()
})
