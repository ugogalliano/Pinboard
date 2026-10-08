import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearSessionTerminatedHandlers,
  notifySessionTerminated,
  onSessionTerminated,
} from './session'

describe('session termination bus', () => {
  afterEach(() => {
    clearSessionTerminatedHandlers()
  })

  it('invokes registered handlers on notify', () => {
    const handler = vi.fn<() => void>()
    onSessionTerminated(handler)

    notifySessionTerminated()

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('dedupes the same handler function (idempotent registration)', () => {
    const handler = vi.fn<() => void>()
    onSessionTerminated(handler)
    onSessionTerminated(handler)

    notifySessionTerminated()

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('is a no-op with no handlers (api.ts terminal failures stay safe)', () => {
    expect(() => notifySessionTerminated()).not.toThrow()
  })
})
