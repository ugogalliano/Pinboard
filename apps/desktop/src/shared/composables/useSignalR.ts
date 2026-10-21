import type { Ref } from 'vue'

import { boardConnectionState, type BoardConnectionState } from '../services/signalr'

// Thin reactive accessor for the board-hub connection state (PLAN.FE.md §3).
// Deliberately the ONLY logic here: shared never learns about feature caches,
// consumers read the service's module-level ref through this wrapper.

/** The live board-hub connection state ('Disconnected' | 'Connecting' | 'Connected' | 'Reconnecting'). */
export function useBoardConnectionState(): Readonly<Ref<BoardConnectionState>> {
  return boardConnectionState
}
