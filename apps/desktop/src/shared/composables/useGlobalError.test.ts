import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
} from '../services/api'
import { clearGlobalError, globalError, reportGlobalError } from './useGlobalError'

describe('useGlobalError', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearGlobalError()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('a plain Error maps to the generic safe message (raw text never stored)', () => {
    const error = new Error('connection to db://secret-host failed at 0x7f…')

    reportGlobalError(error)

    expect(globalError.value).not.toBeNull()
    expect(globalError.value!.message).toBe('Something went wrong. Please try again.')
    expect(globalError.value!.message).not.toContain('secret-host')
    expect(globalError.value!.message).not.toContain('at 0x7f')
  })

  it('an ApiError maps through the §13 status table (403 example)', () => {
    reportGlobalError(new ApiError(403, { status: 403, detail: 'hidden reason' }))

    expect(globalError.value!.message).toBe("You don't have permission for this action")
    // The mapped text is safe: the problem `detail` is not echoed for 403.
    expect(globalError.value!.message).not.toContain('hidden reason')
  })

  it('reports the raw error to console.error exactly once per call', () => {
    const error = new Error('boom')

    reportGlobalError(error, 'App rendered')

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith('[global-error]', 'App rendered', error)
  })

  it('is last-wins: a second report replaces the first (no queue)', () => {
    reportGlobalError(new ApiError(404, { status: 404 }))
    expect(globalError.value!.message).toBe('Resource not found')

    reportGlobalError(new ApiError(409, { status: 409 }))
    expect(globalError.value!.message).toBe('This action conflicts with current state')
  })

  it('clearGlobalError resets to null', () => {
    reportGlobalError(new Error('boom'))
    clearGlobalError()

    expect(globalError.value).toBeNull()
  })
})
