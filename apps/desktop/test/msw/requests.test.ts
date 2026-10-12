import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'

import { server } from './server'
import { callsTo, requestLog } from './requests'

/**
 * Regression guard for the shared MSW infrastructure (AGENTS.md §6).
 *
 * Handler isolation (resetHandlers) and `onUnhandledRequest: 'error'` cannot be
 * asserted from a PASSING test — both are only observable as a loud failure for
 * a request no handler answers. They are verified by the suite itself: every
 * migrated test declares exactly its handlers, and an un-mocked request aborts
 * the test with "Cannot bypass a request when using the 'error' strategy".
 * What CAN be asserted positively — the request log shape, `callsTo` filtering
 * and the afterEach log reset — is covered here.
 */
describe('MSW test infrastructure', () => {
  it('records normalized method + path and callsTo filters by path', async () => {
    server.use(
      http.get('/api/infra?x=1', () => HttpResponse.json({ ok: true })),
      http.post('/api/infra-other', () => HttpResponse.json({ ok: true })),
    )

    await fetch('/api/infra?x=1')
    await fetch('/api/infra-other', { method: 'POST' })

    // Origin stripped, path + query preserved, sent order kept.
    expect(requestLog).toEqual([
      { method: 'GET', url: '/api/infra?x=1' },
      { method: 'POST', url: '/api/infra-other' },
    ])
    expect(callsTo('/api/infra?x=1')).toHaveLength(1)
    expect(callsTo('/api/infra-other')).toHaveLength(1)
    expect(callsTo('/api/infra-other?missing=1')).toHaveLength(0)
  })

  it('clears the request log between tests (afterEach resetRequestLog is wired)', async () => {
    // The previous test issued two requests; if the afterEach hook in
    // ./setup.ts did not call resetRequestLog(), they would still be here.
    expect(requestLog).toHaveLength(0)
    expect(callsTo('/api/infra?x=1')).toHaveLength(0)
  })
})
