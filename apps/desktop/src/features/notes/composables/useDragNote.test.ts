import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, effectScope, h } from 'vue'

import { clientToCanvas, useDragNote } from './useDragNote'
import { notesKeys } from './useNotes'
import { useDebounce } from '@/shared/composables/useDebounce'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../test/msw/server'
import { callsTo, requestLog } from '../../../../test/msw/requests'
import type { NoteDto, UpdateNoteRequest } from '@/shared/types/api'

const BOARD = 'b1'

function note(id: string, overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    id,
    boardId: BOARD,
    createdBy: 'u1',
    content: 'Hello',
    color: 'note-yellow',
    positionX: 0,
    positionY: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

describe('useDragNote', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  // Fake timers are mandatory here (useDebounce.test.ts idiom): the commit
  // window must be driven explicitly, never awaited in real time.
  beforeEach(() => {
    vi.useFakeTimers()
    pinia = createPinia()
    setActivePinia(pinia)
    queryClient = makeQueryClient()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Advances fake time AND flushes the microtask queue between timers. */
  async function tick(ms = 300): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms)
  }

  function mountDrag(debounceMs?: number) {
    let api!: ReturnType<typeof useDragNote>
    const Harness = defineComponent({
      setup() {
        api = useDragNote(
          debounceMs === undefined ? { boardId: BOARD } : { boardId: BOARD, debounceMs },
        )
        return () => h('div')
      },
    })
    const wrapper = mount(Harness, {
      global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] },
    })
    return { wrapper, api }
  }

  /** Stateful fake server for one seeded note; captures PUT bodies. */
  function stubNoteApi(stored: NoteDto[], noteId = 'n1'): { bodies: UpdateNoteRequest[] } {
    const bodies: UpdateNoteRequest[] = []
    server.use(
      http.put(API_URLS.notes.detail(noteId), async ({ request }) => {
        const body = (await request.json()) as UpdateNoteRequest
        bodies.push(body)
        const index = stored.findIndex((item) => item.id === noteId)
        const merged: NoteDto = {
          ...stored[index]!,
          content: body.content,
          color: body.color,
          positionX: body.positionX,
          positionY: body.positionY,
        }
        stored[index] = merged
        return HttpResponse.json(merged)
      }),
    )
    return { bodies }
  }

  it('coalesces three commits of the same note into the LAST position', async () => {
    const stored = [note('n1', { positionX: 1, positionY: 1 })]
    const { bodies } = stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.commit('n1', 10, 10)
    api.commit('n1', 20, 20)
    api.commit('n1', 30, 30)

    // 149 ms in: the trailing window has not elapsed — nothing has been sent.
    vi.advanceTimersByTime(149)
    await flushPromises()
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(0)

    // +1 ms: exactly ONE request, carrying the LAST args only.
    await tick(1)
    await tick(300)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ positionX: 30, positionY: 30 })
  })

  it('flush() fires the pending commit immediately', async () => {
    const stored = [note('n1')]
    const { bodies } = stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.commit('n1', 42, 43)
    api.flush()
    await tick(300)

    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ positionX: 42, positionY: 43 })

    // The debounce timer was cleared: nothing fires later.
    await tick(500)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
  })

  it('persists a pending commit on unmount thanks to the explicit flush hook', async () => {
    const stored = [note('n1')]
    const { bodies } = stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api, wrapper } = mountDrag()
    api.commit('n1', 50, 60)
    wrapper.unmount() // onBeforeUnmount → flush → submit starts right away

    await tick(500)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ positionX: 50, positionY: 60 })
  })

  it('shows why the flush hook exists: the raw useDebounce dispose CANCELS the pending call', async () => {
    // Without useDragNote's explicit onBeforeUnmount flush, unmount would hit
    // this path — useDebounce auto-cancels on scope dispose and the final
    // drag of a leaving canvas would silently vanish (perf review P1).
    const spy = vi.fn<(...args: unknown[]) => void>()
    const scope = effectScope()

    const debounced = scope.run(() => useDebounce(spy, 150))!
    debounced('pending-commit')
    scope.stop()

    await tick(500)
    expect(spy).not.toHaveBeenCalled()
  })

  it('skips commits for temp notes — no PUT is ever sent to /api/notes/temp-*', async () => {
    const harness = mountDrag()
    queryClient.setQueryData(notesKeys.list(BOARD), [note('temp-abc')])

    harness.api.commit('temp-abc', 5, 5)
    await tick(500)

    // Not a single request left the composable.
    expect(requestLog).toHaveLength(0)
    harness.wrapper.unmount()
  })

  it('issues no network during the gesture: moves only update local refs', async () => {
    const stored = [note('n1', { positionX: 10, positionY: 20 })]
    stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })

    api.onPointerMove({ clientX: 120, clientY: 110 })
    api.onPointerMove({ clientX: 150, clientY: 130 })

    expect(requestLog).toHaveLength(0)
    expect(api.draggingId.value).toBe('n1')
    expect(api.dragOffset.value).toEqual({ x: 50, y: 30 })
    expect(api.livePosition.value).toEqual({ x: 60, y: 50 })
    // The cache was NOT touched mid-gesture (the card renders the delta).
    expect(stored[0]!.positionX).toBe(10)

    // endDrag commits exactly the live position, content from the freshest
    // cache entry (the PUT body is the full UpdateNoteRequest).
    api.endDrag()
    expect(api.draggingId.value).toBeNull()
    await tick(500)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
  })

  it('a move without a drag is a no-op', async () => {
    const { api } = mountDrag()
    api.onPointerMove({ clientX: 10, clientY: 10 })
    api.endDrag()
    await tick(300)
    expect(requestLog).toHaveLength(0)
  })

  it('a zero-move gesture commits nothing — plain click and there-and-back drags', async () => {
    // The endDrag guard (step-2 addition): a gesture with ZERO net offset is a
    // plain click / one half of a dblclick-to-edit; committing it would fire a
    // redundant PUT per click. One pixel is the smallest movement that commits.
    const stored = [note('n1', { positionX: 10, positionY: 20 })]
    const { bodies } = stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()

    // 1. Pointerdown + up without ANY move (a plain click).
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })
    api.endDrag()

    // 2. Move away and back: the OFFSET at release is zero, so no commit.
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })
    api.onPointerMove({ clientX: 150, clientY: 130 })
    api.onPointerMove({ clientX: 100, clientY: 100 })
    api.endDrag()

    // 3. Control: a genuine 1 px move DOES commit, at the live position.
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })
    api.onPointerMove({ clientX: 101, clientY: 100 })
    api.endDrag()
    expect(api.draggingId.value).toBeNull()

    await tick(500)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ positionX: 11, positionY: 20 })
  })

  it('drops of TWO different notes in one window BOTH commit — no silent loss', async () => {
    // Regression (review fix 2): the old single-args-slot debounce kept only
    // the LAST commit of the window, so dropping note A and then note B
    // within ~150 ms silently discarded A's PUT.
    const stored = [note('n1', { positionX: 1, positionY: 1 }), note('n2', { positionX: 2, positionY: 2 })]
    const n1 = stubNoteApi(stored, 'n1')
    const n2 = stubNoteApi(stored, 'n2')
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.commit('n1', 10, 10)
    await tick(100) // same coalesce window: n1's timer has NOT elapsed yet
    api.commit('n2', 20, 20)

    await tick(300)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(callsTo(API_URLS.notes.detail('n2'), 'PUT')).toHaveLength(1)
    expect(n1.bodies[0]).toMatchObject({ positionX: 10, positionY: 10 })
    expect(n2.bodies[0]).toMatchObject({ positionX: 20, positionY: 20 })
  })

  it('unmount flushes ALL pending commits, not just the last note', async () => {
    // The explicit onBeforeUnmount flush drains the WHOLE pending map: two
    // notes dropped right before leaving the canvas both persist.
    const stored = [note('n1'), note('n2')]
    const n1 = stubNoteApi(stored, 'n1')
    const n2 = stubNoteApi(stored, 'n2')
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api, wrapper } = mountDrag()
    api.commit('n1', 50, 60)
    api.commit('n2', 70, 80)
    wrapper.unmount() // onBeforeUnmount → flush drains both entries

    await tick(500)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(callsTo(API_URLS.notes.detail('n2'), 'PUT')).toHaveLength(1)
    expect(n1.bodies[0]).toMatchObject({ positionX: 50, positionY: 60 })
    expect(n2.bodies[0]).toMatchObject({ positionX: 70, positionY: 80 })
  })

  it('endDrag retains the dropped position as pendingVisual until the commit lands', async () => {
    // Review fix 3: the live gesture state clears at pointerup while the PUT
    // (and its optimistic cache write) only lands ~150 ms later. The retained
    // `pendingVisual` lets the CANVAS keep the card painted at the drop spot
    // meanwhile — the cache itself is untouched until the commit fires.
    const stored = [note('n1', { positionX: 10, positionY: 20 })]
    stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })
    api.onPointerMove({ clientX: 150, clientY: 130 })
    api.endDrag()

    expect(api.draggingId.value).toBeNull()
    expect(api.dragOffset.value).toEqual({ x: 0, y: 0 })
    expect(api.pendingVisual.value).toEqual({ id: 'n1', x: 60, y: 50 })

    // The commit's optimistic write lands the same position, and the
    // mutation's settle handler drops the retention once it is moot.
    await tick(500)
    expect(stored[0]!.positionX).toBe(60)
    expect(stored[0]!.positionY).toBe(50)
    expect(api.pendingVisual.value).toBeNull()
  })

  it('a zero-move gesture retains no pendingVisual', async () => {
    const stored = [note('n1', { positionX: 10, positionY: 20 })]
    stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })
    api.endDrag()
    expect(api.pendingVisual.value).toBeNull()
    await tick(500)
    expect(requestLog).toHaveLength(0)
  })

  it('starting a new drag clears the retained visual — last drop wins', async () => {
    const stored = [note('n1', { positionX: 10, positionY: 20 }), note('n2', { positionX: 1, positionY: 1 })]
    stubNoteApi(stored, 'n1')
    stubNoteApi(stored, 'n2')
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })
    api.onPointerMove({ clientX: 150, clientY: 130 })
    api.endDrag()
    expect(api.pendingVisual.value).toEqual({ id: 'n1', x: 60, y: 50 })

    // Dragging ANY note (same or different) resets the retained visual; the
    // pending COMMIT map is untouched, so n1's drop still persists.
    api.startDrag(stored[1]!, { clientX: 0, clientY: 0 })
    expect(api.pendingVisual.value).toBeNull()
    await tick(500)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
  })

  it('cancelDrag ends the gesture WITHOUT committing and clears the retained visual', async () => {
    const stored = [note('n1', { positionX: 10, positionY: 20 })]
    stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })
    api.onPointerMove({ clientX: 150, clientY: 130 })
    api.cancelDrag()

    expect(api.draggingId.value).toBeNull()
    expect(api.dragOffset.value).toEqual({ x: 0, y: 0 })
    expect(api.pendingVisual.value).toBeNull()

    await tick(500)
    expect(requestLog).toHaveLength(0)
  })

  it('cancelDrag of a re-dragged note also drops its retained visual', async () => {
    const stored = [note('n1', { positionX: 10, positionY: 20 })]
    stubNoteApi(stored)
    queryClient.setQueryData(notesKeys.list(BOARD), stored)

    const { api } = mountDrag()
    api.startDrag(stored[0]!, { clientX: 100, clientY: 100 })
    api.onPointerMove({ clientX: 150, clientY: 130 })
    api.endDrag()
    expect(api.pendingVisual.value).not.toBeNull()

    // Re-drag clears the visual via startDrag; cancelling adds no commit, so
    // exactly the FIRST drop's PUT survives.
    api.startDrag(stored[0]!, { clientX: 200, clientY: 200 })
    api.onPointerMove({ clientX: 260, clientY: 240 })
    api.cancelDrag()
    expect(api.pendingVisual.value).toBeNull()

    await tick(500)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
  })

  describe('clientToCanvas', () => {
    it('converts client → canvas coordinates with scroll compensation', () => {
      const rect = { left: 100, top: 40 } as DOMRect

      // No scroll: pure origin shift.
      expect(clientToCanvas(250, 140, rect, 0, 0)).toEqual({ x: 150, y: 100 })
      // With scroll: the scrolled-away pixels add back.
      expect(clientToCanvas(250, 140, rect, 10, 20)).toEqual({ x: 160, y: 120 })
      // Negative results are legitimate (pointer left/above the container).
      expect(clientToCanvas(50, 10, rect, 0, 0)).toEqual({ x: -50, y: -30 })
    })
  })
})
