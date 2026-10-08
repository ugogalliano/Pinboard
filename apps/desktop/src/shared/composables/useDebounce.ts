import { getCurrentScope, onScopeDispose } from 'vue'

export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** Invoke the pending call immediately (if any). */
  flush(): void
  /** Drop the pending call without invoking it. */
  cancel(): void
}

/**
 * Trailing-edge debounce with `flush`/`cancel`. When created inside a reactive
 * effect scope (component setup, `effectScope`), the pending call is cancelled
 * on scope dispose — no stray timers after unmount.
 */
export function useDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null

  function invoke(): void {
    if (lastArgs !== null) {
      const args = lastArgs
      lastArgs = null
      fn(...args)
    }
  }

  const debounced = ((...args: A): void => {
    lastArgs = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      invoke()
    }, ms)
  }) as Debounced<A>

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    lastArgs = null
  }

  debounced.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    invoke()
  }

  if (getCurrentScope()) {
    onScopeDispose(() => debounced.cancel())
  }

  return debounced
}
