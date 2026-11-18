// Note canvas-coordinate bounds mirrored from the backend (NoteService
// sanity validation: ArgumentException → 400 with detail). Positions may be
// NEGATIVE (scrolled-off-canvas placement is legitimate); only |value| ≤
// 1 000 000 is accepted. Single source of truth: the Zod schema
// (shared/validation/schemas.ts) and the gesture call sites (drag commits,
// canvas double-click) all reference these values, so an out-of-range drop is
// rejected CLIENT-side without ever issuing a request.

/** Inclusive upper bound for `positionX`/`positionY` (wire type: int). */
export const NOTE_POSITION_MAX = 1_000_000

/** Inclusive lower bound — negatives are allowed. */
export const NOTE_POSITION_MIN = -NOTE_POSITION_MAX

/** True when an integer canvas point lies inside the server's sanity bounds. */
export function isWithinNotePositionBounds(x: number, y: number): boolean {
  return x >= NOTE_POSITION_MIN && x <= NOTE_POSITION_MAX && y >= NOTE_POSITION_MIN && y <= NOTE_POSITION_MAX
}
