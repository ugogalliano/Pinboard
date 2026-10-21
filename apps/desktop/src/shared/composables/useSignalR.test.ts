import { describe, expect, it } from 'vitest'

import { boardConnectionState, stopBoardHub } from '../services/signalr'
import { useBoardConnectionState } from './useSignalR'

describe('useBoardConnectionState', () => {
  it('exposes the service connection-state ref (same object, thin accessor)', () => {
    expect(useBoardConnectionState()).toBe(boardConnectionState)
  })

  it('reflects the service state', async () => {
    await stopBoardHub()

    expect(useBoardConnectionState().value).toBe('Disconnected')
  })
})
