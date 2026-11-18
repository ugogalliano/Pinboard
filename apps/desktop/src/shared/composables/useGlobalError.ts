import { ref, type Ref } from 'vue'

import { mapApiErrorToMessage } from '../services/api'

// Global error boundary state (PLAN.FE.md §13 layer 4). Module-scoped
// singleton following the signalr.ts pattern: an internal ref exported
// readonly, written only through the functions below — so main.ts's
// app.config.errorHandler and App.vue's onErrorCaptured can report into the
// SAME state without any store or provide/inject plumbing.

export interface GlobalError {
  /** Safe, §13-mapped display text — never raw error text or stack. */
  message: string
}

const globalErrorInternal = ref<GlobalError | null>(null)

/** The one visible boundary error; `null` means no fallback is shown. */
export const globalError: Readonly<Ref<GlobalError | null>> = globalErrorInternal

/**
 * Record an unhandled error for the ErrorFallback. LAST-WINS by design: the
 * boundary shows one failure at a time, and the first report already stops
 * propagation, so a burst never queues. Only the mapped message is STORED —
 * the raw error goes to console.error exactly once (devtools/debug aid; the
 * UI must never render it, AGENTS.md §7). `context` (the Vue lifecycle info
 * string) rides along in the console line to say WHERE it came from.
 */
export function reportGlobalError(error: unknown, context?: string): void {
  if (context) {
    console.error('[global-error]', context, error)
  } else {
    console.error('[global-error]', error)
  }
  globalErrorInternal.value = { message: mapApiErrorToMessage(error) }
}

/** Dismiss the boundary (used by the fallback's retry flow in App.vue). */
export function clearGlobalError(): void {
  globalErrorInternal.value = null
}
