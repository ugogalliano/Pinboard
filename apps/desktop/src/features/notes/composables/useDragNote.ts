import { computed, getCurrentScope, onBeforeUnmount, onScopeDispose, ref, type MaybeRef } from 'vue'

import { useUpdateNote } from './useNotes'

/** A point in canvas coordinates (pixels, matching positionX/positionY). */
export interface CanvasPoint {
  x: number
  y: number
}

/** The only note fields a drag needs to start (a `NoteDto` satisfies it). */
export interface DragStartNote {
  id: string
  positionX: number
  positionY: number
}

/** Structural type for the pointer positions we read (PointerEvent fits). */
export interface DragPointer {
  clientX: number
  clientY: number
}

/**
 * A committed drop whose final position is still NOT visible in the cache:
 * `{ id, x, y }` are canvas coordinates of the drop. The canvas keeps the
 * transform applied to that card (delta = drop − cached position) until the
 * commit's optimistic write makes the delta zero; the composable then clears
 * the retention when the mutation settles — success keeps the drop on
 * screen, a failed drag snaps back to the restored old position — so
 * releasing never snaps the card back for the debounce window
 * (review fix 3: editor snap-back flicker).
 */
export interface PendingVisual {
  id: string
  x: number
  y: number
}

export interface UseDragNoteOptions {
  /** Board whose notes cache the commit targets (forwarded to useUpdateNote). */
  boardId: MaybeRef<string>
  /** Trailing coalesce window for rapid successive drops (default 150 ms). */
  debounceMs?: number
}

/**
 * The single client → canvas conversion, shared by dblclick-create (spawn at
 * cursor) and drag commits: canvas coords are client coords relative to the
 * container's origin, plus the container's current scroll. When zoom lands,
 * EVERY coordinate path must route through this one function (perf review P5)
 * — no call site may do its own pixel arithmetic against `getBoundingClientRect`.
 */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  scrollLeft: number,
  scrollTop: number,
): CanvasPoint {
  return {
    x: Math.round((clientX - rect.left + scrollLeft) * 100) / 100,
    y: Math.round((clientY - rect.top + scrollTop) * 100) / 100,
  }
}

/**
 * Drag state + commit for the canvas (PLAN.FE.md §11/§12). The composable
 * owns only TRANSIENT gesture state (never Pinia, never the query cache):
 * a baseline recorded once at drag start (pointer origin + note origin), a
 * `draggingId`, and a live `dragOffset` that the CARD applies visually via
 * `transform` — per-move cache writes are deliberately absent (AGENTS.md §8:
 * no layout thrashing, no refetch churn). The single PUT owner is
 * `useUpdateNote`; this file NEVER defines its own mutation. Pointer capture,
 * `touch-action` and `user-select` are card/canvas concerns (step 2); the
 * exposed `draggingId` lets `PostItCard` scope its `will-change`/transform.
 *
 * Commit path: `endDrag()` → `commit()` → a `Map<noteId, CanvasPoint>` of
 * pending positions drained by ONE trailing timer (~`debounceMs`) → per
 * entry `useUpdateNote.mutateAsync` with POSITION fields only, so the
 * freshest cached content/color wins over anything the card snapshotted at
 * drag start (perf review P-freshest). Repeated drops of the SAME note
 * coalesce to that note's last position (map overwrite); drops of DIFFERENT
 * notes within one window each keep their own entry, so a cross-note burst
 * loses no commit (review fix: a single-slot debounced submitter silently
 * dropped note A when note B was dropped before the window elapsed).
 */
export function useDragNote(options: UseDragNoteOptions) {
  const debounceMs = options.debounceMs ?? 150
  const update = useUpdateNote(options.boardId)

  const draggingId = ref<string | null>(null)
  /** Note position captured ONCE at pointerdown — the delta baseline. */
  const noteOrigin = ref<CanvasPoint>({ x: 0, y: 0 })
  /** Pointer client position captured ONCE at pointerdown. */
  const pointerOrigin = ref<CanvasPoint>({ x: 0, y: 0 })
  /** Live client-space delta; the card renders `transform: translate(...)`. */
  const dragOffset = ref<CanvasPoint>({ x: 0, y: 0 })
  /** Committed drop position not yet visible in the cache (see PendingVisual). */
  const pendingVisual = ref<PendingVisual | null>(null)

  /** Where the dragged note will land if the gesture ends right now. */
  const livePosition = computed<CanvasPoint>(() => ({
    x: noteOrigin.value.x + dragOffset.value.x,
    y: noteOrigin.value.y + dragOffset.value.y,
  }))

  /** Pending position commits per note — drained together by one timer. */
  const pendingCommits = new Map<string, CanvasPoint>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function submit(noteId: string, x: number, y: number): void {
    // Skip temp notes (optimistic creates still in flight): the backend has
    // no `temp-*` id — a PUT would 404 and toast a phantom error.
    if (noteId.startsWith('temp-')) return
    // Fire-and-forget: failures are already rolled back + toasted inside
    // useUpdateNote; the catch only keeps the floating promise away from
    // becoming an unhandled rejection. Concurrent mutateAsync calls are safe:
    // they all share the one useUpdateNote mutation.
    update
      .mutateAsync({ id: noteId, positionX: x, positionY: y })
      .catch(() => undefined)
      .finally(() => {
        // Review fix 3: once the commit settles the retained visual is moot —
        // on SUCCESS the cache now carries the committed position (the delta
        // already rendered as zero since the optimistic write), so clearing
        // changes nothing; on FAILURE the snapshot rollback has landed, and
        // clearing lets the card snap back to the restored OLD position as
        // the truthful state. Also covers deletes (404 → settle → clear).
        if (pendingVisual.value?.id === noteId) pendingVisual.value = null
      })
  }

  /** Drain the pending-commit map NOW: clears the timer and submits each entry. */
  function flushPending(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (pendingCommits.size === 0) return
    const entries = [...pendingCommits.entries()]
    pendingCommits.clear()
    for (const [noteId, point] of entries) submit(noteId, point.x, point.y)
  }

  // `onBeforeUnmount` hooks run BEFORE the instance scope is stopped, so this
  // flush wins over the dispose-cancel below — without it the last drags of a
  // leaving canvas would silently never persist (perf review P1).
  onBeforeUnmount(flushPending)

  // Mirror the old `useDebounce` dispose behaviour: a bare scope stop (tests,
  // non-component usage) drops the timer and the pending map without firing.
  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (flushTimer !== null) clearTimeout(flushTimer)
      flushTimer = null
      pendingCommits.clear()
    })
  }

  /**
   * Begin a gesture: records the baseline (note origin + pointer origin) in
   * local refs. Deliberately reads NO geometry: at scale 1 a client-space
   * delta equals the canvas-space delta, so no rect/scroll read is needed
   * per gesture (and none, ever, inside the move handler). A previously
   * committed note's retained visual is dropped here — the new gesture owns
   * the screen, and the pending COMMIT (map entry) is untouched, so the
   * last drop still wins when its entry lands.
   */
  function startDrag(note: DragStartNote, event: DragPointer): void {
    pendingVisual.value = null
    draggingId.value = note.id
    noteOrigin.value = { x: note.positionX, y: note.positionY }
    pointerOrigin.value = { x: event.clientX, y: event.clientY }
    dragOffset.value = { x: 0, y: 0 }
  }

  /** Track the gesture: local refs only, ZERO cache writes or requests. */
  function onPointerMove(event: DragPointer): void {
    if (draggingId.value === null) return
    dragOffset.value = {
      x: event.clientX - pointerOrigin.value.x,
      y: event.clientY - pointerOrigin.value.y,
    }
  }

  /**
   * End the gesture: commit the final position, retain the final VISUAL on
   * the card (cleared by `submit`'s settle handler — see PendingVisual),
   * then release the live gesture state.
   */
  function endDrag(): void {
    if (draggingId.value === null) return
    const id = draggingId.value
    const { x, y } = livePosition.value
    // A gesture with ZERO net movement (a plain click / one half of a card
    // double-click) does not change the position — committing it would fire a
    // redundant PUT per click and double the PUTs of a dblclick-to-edit.
    if (dragOffset.value.x !== 0 || dragOffset.value.y !== 0) {
      commit(id, x, y)
      if (!id.startsWith('temp-')) {
        pendingVisual.value = { id, x, y }
      }
    }
    draggingId.value = null
    dragOffset.value = { x: 0, y: 0 }
  }

  /**
   * Abandon the gesture (pointercancel): a cancelled pointer is NOT a
   * user-intended position, so drag state resets WITHOUT committing, and a
   * retained visual for the cancelled note is dropped. Pending commits of
   * EARLIER deliberate drops stay scheduled — they were real gestures.
   */
  function cancelDrag(): void {
    if (draggingId.value === null) return
    const id = draggingId.value
    draggingId.value = null
    dragOffset.value = { x: 0, y: 0 }
    if (pendingVisual.value?.id === id) pendingVisual.value = null
  }

  /**
   * Schedule (coalesced) a position commit for `noteId` at canvas `x`/`y`.
   * Map overwrite per note makes same-note repeats collapse to the last
   * position; distinct notes each keep their own entry.
   * Test seam: public so unit tests can drive commits without pointer events.
   */
  function commit(noteId: string, x: number, y: number): void {
    pendingCommits.set(noteId, { x, y })
    if (flushTimer !== null) clearTimeout(flushTimer)
    flushTimer = setTimeout(flushPending, debounceMs)
  }

  return {
    draggingId,
    dragOffset,
    livePosition,
    pendingVisual,
    startDrag,
    onPointerMove,
    endDrag,
    cancelDrag,
    commit,
    /**
     * Persist ALL pending commits right now (used by the unmount hook; also
     * a test seam for deterministic flushes).
     */
    flush: flushPending,
  }
}
