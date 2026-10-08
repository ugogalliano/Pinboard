import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useDebounce } from './useDebounce'

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('invokes the function once with the last arguments after the delay', () => {
    const fn = vi.fn<(...args: unknown[]) => void>()
    const debounced = useDebounce(fn, 200)

    debounced('a')
    debounced('b')
    debounced('c')

    vi.advanceTimersByTime(199)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('flush() invokes the pending call immediately', () => {
    const fn = vi.fn<(...args: unknown[]) => void>()
    const debounced = useDebounce(fn, 200)

    debounced(1, 2)
    debounced.flush()

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(1, 2)

    // The pending timer was cleared: nothing fires later.
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('flush() is a no-op when nothing is pending', () => {
    const fn = vi.fn<(...args: unknown[]) => void>()
    const debounced = useDebounce(fn, 200)

    debounced.flush()
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel() drops the pending call', () => {
    const fn = vi.fn<(...args: unknown[]) => void>()
    const debounced = useDebounce(fn, 200)

    debounced('x')
    debounced.cancel()

    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancels the pending call when the effect scope is disposed', () => {
    const fn = vi.fn<(...args: unknown[]) => void>()
    const scope = effectScope()

    const debounced = scope.run(() => useDebounce(fn, 200))!
    debounced('x')

    scope.stop()

    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
