import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, VueWrapper } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { useToast } from '@ugogalliano/pm-design-system-vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import NoteCanvas from './NoteCanvas.vue'
import PostItCard from '../PostItCard/PostItCard.vue'
import { notesKeys } from '../../composables/useNotes'
import { useAuthStore } from '@/stores/authStore'
import { membersKeys } from '@/features/members'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../../test/msw/server'
import { callsTo, requestLog } from '../../../../../test/msw/requests'
import type { NoteDto } from '@/shared/types/api'

const BOARD = 'b1'
const LIST_URL = API_URLS.notes.list(BOARD)
const MEMBERS_URL = API_URLS.members.list(BOARD)

function note(id: string, overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    id,
    boardId: BOARD,
    createdBy: 'u1',
    content: 'Hello',
    color: 'note-yellow',
    positionX: 10,
    positionY: 20,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/** Advances fake time AND flushes the microtask queue between timers. */
async function tick(ms = 300): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('NoteCanvas', () => {
  let pinia: ReturnType<typeof createPinia>
  let queryClient: QueryClient

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser({ id: 'u1', email: 'a@b.co', displayName: 'Ada' })
    server.use(
      http.get(MEMBERS_URL, () =>
        HttpResponse.json([
          {
            userId: 'u1',
            email: 'a@b.co',
            displayName: 'Ada',
            role: 'Owner',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ]),
      ),
    )
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    useToast().clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  /**
   * Mounts the canvas behind a real `/boards/:boardId` route so the composable
   * reads the param exactly like the app does (no stubbed useRoute).
   */
  async function mountCanvas(): Promise<{ wrapper: VueWrapper; router: Router }> {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/boards/:boardId', name: 'board-canvas', component: NoteCanvas }],
    })
    await router.push(`/boards/${BOARD}`)
    await router.isReady()

    const wrapper = mount(NoteCanvas, {
      global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]] },
    })
    return { wrapper, router }
  }

  /** Stateful notes store shared by the handlers a test registers. */
  function stubNotes(stored: NoteDto[]) {
    const postBodies: Record<string, unknown>[] = []
    const putBodies: Record<string, unknown>[] = []
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      http.post(LIST_URL, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        postBodies.push(body)
        const created = note(`n${stored.length + 1}`, {
          content: body.content as string,
          color: body.color as string,
          positionX: body.positionX as number,
          positionY: body.positionY as number,
        })
        stored.push(created)
        return HttpResponse.json(created)
      }),
      http.put(API_URLS.notes.detail(':noteId'), async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>
        putBodies.push(body)
        const index = stored.findIndex((item) => item.id === params.noteId)
        const merged = { ...stored[index]!, ...body } as NoteDto
        stored[index] = merged
        return HttpResponse.json(merged)
      }),
      http.delete(API_URLS.notes.detail(':noteId'), ({ params }) => {
        const index = stored.findIndex((item) => item.id === params.noteId)
        if (index >= 0) stored.splice(index, 1)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    return { stored, postBodies, putBodies }
  }

  /** Opens a draft with a canvas double-click at the given client point. */
  async function dblClickCanvas(wrapper: VueWrapper, x: number, y: number): Promise<void> {
    await wrapper.find('[data-testid="note-canvas"]').trigger('dblclick', { clientX: x, clientY: y })
    await flushPromises()
  }

  it('shows a spinner while the notes are loading', async () => {
    // A never-resolving handler keeps the query in its initial pending state.
    server.use(http.get(LIST_URL, () => new Promise<Response>(() => {})))
    const { wrapper } = await mountCanvas()

    expect(wrapper.find('[data-testid="note-canvas-loading"]').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('shows an error state whose retry issues a second GET', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json({ status: 500 }, { status: 500 })),
    )

    const { wrapper } = await mountCanvas()
    await settle()
    expect(callsTo(LIST_URL, 'GET')).toHaveLength(1)

    await wrapper.find('[data-testid="note-canvas-retry"]').trigger('click')
    await settle()

    expect(callsTo(LIST_URL, 'GET')).toHaveLength(2)
  })

  it('renders the helpful empty state when the board has no notes', async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.json([])))

    const { wrapper } = await mountCanvas()
    await settle()

    expect(wrapper.find('[data-testid="note-canvas-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="post-it-card"]')).toHaveLength(0)
  })

  it('renders one card per note with its content', async () => {
    stubNotes([note('n1', { content: 'Buy milk' }), note('n2', { content: 'Ship docs' })])

    const { wrapper } = await mountCanvas()
    await settle()

    const cards = wrapper.findAll('[data-testid="post-it-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('Buy milk')
    expect(cards[1]!.text()).toContain('Ship docs')
  })

  it('double-click opens a LOCAL draft — zero requests beyond the initial GET', async () => {
    stubNotes([])

    const { wrapper } = await mountCanvas()
    await settle()

    await dblClickCanvas(wrapper, 120, 80)

    expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(true)
    // Editor-first create: nothing left the browser yet.
    expect(requestLog).toEqual([
      { method: 'GET', url: MEMBERS_URL },
      { method: 'GET', url: LIST_URL },
    ])
  })

  it('Escape closes the draft with zero POSTs', async () => {
    stubNotes([])

    const { wrapper } = await mountCanvas()
    await settle()

    await dblClickCanvas(wrapper, 120, 80)
    await wrapper.find('[data-testid="note-draft-content"]').trigger('keydown', { key: 'Escape' })
    await settle()

    expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(false)
    expect(callsTo(LIST_URL, 'POST')).toHaveLength(0)
  })

  it('saving the draft POSTs the full note at the double-click point and lands the real card', async () => {
    const { stored, postBodies } = stubNotes([])

    const { wrapper } = await mountCanvas()
    await settle()

    await dblClickCanvas(wrapper, 120, 80)
    await wrapper.find('[data-testid="note-draft-content"]').setValue('Buy milk')
    await wrapper.find('[data-testid="note-draft-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    // jsdom rects are zeroed, so the passed-through client point IS the
    // expected canvas position (clientToCanvas math is unit-tested already).
    expect(postBodies).toHaveLength(1)
    expect(postBodies[0]).toEqual({
      content: 'Buy milk',
      color: 'note-yellow',
      positionX: 120,
      positionY: 80,
    })
    const cards = wrapper.findAll('[data-testid="post-it-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.text()).toContain('Buy milk')
    expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(false)
    expect(stored).toHaveLength(1)
  })

  it('shows exactly ONE temp card while the create POST is in flight', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json([])),
      http.post(LIST_URL, () => new Promise<Response>(() => {})),
    )

    const { wrapper } = await mountCanvas()
    await settle()

    await dblClickCanvas(wrapper, 120, 80)
    await wrapper.find('[data-testid="note-draft-content"]').setValue('Buy milk')
    await wrapper.find('[data-testid="note-draft-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    const cards = wrapper.findAll('[data-testid="post-it-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.attributes('data-note-id')).toMatch(/^temp-/)
    const cached = queryClient.getQueryData<NoteDto[]>(notesKeys.list(BOARD))
    expect(cached?.map((item) => item.id)).toEqual([expect.stringMatching(/^temp-/)])
  })

  it('a second canvas double-click replaces the draft — still ONE draft, ONE POST', async () => {
    const { postBodies } = stubNotes([])

    const { wrapper } = await mountCanvas()
    await settle()

    await dblClickCanvas(wrapper, 10, 10)
    await dblClickCanvas(wrapper, 200, 50)

    expect(wrapper.findAll('[data-testid="note-draft"]')).toHaveLength(1)

    await wrapper.find('[data-testid="note-draft-content"]').setValue('Only one')
    await wrapper.find('[data-testid="note-draft-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    expect(postBodies).toHaveLength(1)
    expect(postBodies[0]).toMatchObject({ positionX: 200, positionY: 50 })
    expect(wrapper.findAll('[data-testid="post-it-card"]')).toHaveLength(1)
  })

  it('a 403 on create rolls the temp back and surfaces exactly one error toast', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json([])),
      http.post(LIST_URL, () =>
        HttpResponse.json({ status: 403, detail: 'Not a member' }, { status: 403 }),
      ),
    )

    const { wrapper } = await mountCanvas()
    await settle()

    // Spy AFTER the initial load: every invalidation the create cycle issues
    // must be prefix-exact on the notes key (never a broad ['boards'] stale).
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await dblClickCanvas(wrapper, 120, 80)
    await wrapper.find('[data-testid="note-draft-content"]').setValue('Denied')
    await wrapper.find('[data-testid="note-draft-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    // Temp note rolled back; the draft STAYS OPEN for a retry.
    expect(wrapper.findAll('[data-testid="post-it-card"]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(true)

    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe("You don't have permission for this action")

    const exactFlags = invalidate.mock.calls.map(([filters]) =>
      typeof filters === 'function' ? undefined : filters?.exact,
    )
    expect(exactFlags.length).toBeGreaterThan(0)
    expect(exactFlags.every((exact) => exact === true)).toBe(true)
  })

  it('double-click on a CARD opens the inline editor over it — no extra requests', async () => {
    stubNotes([note('n1', { content: 'Hello' })])

    const { wrapper } = await mountCanvas()
    await settle()

    await wrapper.find('[data-testid="post-it-card"]').trigger('dblclick')
    await settle()

    expect(wrapper.find('[data-testid="note-editor"]').exists()).toBe(true)
    // The card's `.stop` keeps the gesture off the canvas handler.
    expect(requestLog).toEqual([
      { method: 'GET', url: MEMBERS_URL },
      { method: 'GET', url: LIST_URL },
    ])
  })

  it('editor save fires ONE PUT with content/color, positions preserved', async () => {
    const { stored, putBodies } = stubNotes([note('n1', { content: 'Hello' })])

    const { wrapper } = await mountCanvas()
    await settle()

    await wrapper.find('[data-testid="post-it-card"]').trigger('dblclick')
    await flushPromises()
    await wrapper.find('[data-testid="note-editor-content"]').setValue('Edited')
    await wrapper.find('[data-testid="note-editor-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(putBodies[0]).toEqual({
      content: 'Edited',
      color: 'note-yellow',
      positionX: 10,
      positionY: 20,
    })
    expect(wrapper.find('[data-testid="note-editor"]').exists()).toBe(false)
    expect(stored[0]!.content).toBe('Edited')
    expect(wrapper.find('[data-testid="post-it-card"]').text()).toContain('Edited')
  })

  it('Escape on the editor closes it with zero PUTs', async () => {
    stubNotes([note('n1')])

    const { wrapper } = await mountCanvas()
    await settle()

    await wrapper.find('[data-testid="post-it-card"]').trigger('dblclick')
    await flushPromises()
    await wrapper.find('[data-testid="note-editor-content"]').setValue('Never saved')
    await wrapper.find('[data-testid="note-editor-content"]').trigger('keydown', { key: 'Escape' })
    await settle()

    expect(wrapper.find('[data-testid="note-editor"]').exists()).toBe(false)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(0)
  })

  it('delete removes the card optimistically while the DELETE is in flight', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json([note('n1')])),
      http.delete(API_URLS.notes.detail(':noteId'), () => new Promise<Response>(() => {})),
    )

    const { wrapper } = await mountCanvas()
    await settle()
    expect(wrapper.findAll('[data-testid="post-it-card"]')).toHaveLength(1)

    await wrapper.find('[data-testid="post-it-card-delete"]').trigger('click')
    await settle()

    expect(wrapper.findAll('[data-testid="post-it-card"]')).toHaveLength(0)
  })

  it('a real drag commits ONE position-only PUT after the debounce window', async () => {
    vi.useFakeTimers()
    const { putBodies } = stubNotes([note('n1', { positionX: 10, positionY: 20 })])

    const { wrapper } = await mountCanvas()
    await tick(300)

    const card = wrapper.find('[data-testid="post-it-card"]').element
    card.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 130 }))
    await tick(0) // let Vue flush the reactive style update

    // Mid-gesture: the dragged card renders the live delta, nothing was sent.
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(0)
    expect((card as HTMLElement).style.transform).toMatch(/^translate3d\(50px, 30px, 0(px)?\)$/)

    window.dispatchEvent(new MouseEvent('pointerup'))
    await tick(300)

    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(putBodies[0]).toEqual({
      content: 'Hello',
      color: 'note-yellow',
      positionX: 60,
      positionY: 50,
    })
  })

  it('a pointermove feeds the live offset to the DRAGGED card only', async () => {
    // Review fix 1 (perf): the offset used to be bound to EVERY card, so one
    // pointermove re-rendered all children. Now non-dragged cards keep a
    // constant zero offset — identical props, byte-identical style.
    vi.useFakeTimers()
    stubNotes([note('n1', { positionX: 10, positionY: 20 }), note('n2', { positionX: 30, positionY: 40 })])

    const { wrapper } = await mountCanvas()
    await tick(300)

    const cards = wrapper.findAllComponents(PostItCard)
    const idleEl = wrapper.findAll('[data-testid="post-it-card"]')[1]!.element as HTMLElement
    const idleStyleBefore = idleEl.getAttribute('style')

    const dragged = wrapper.findAll('[data-testid="post-it-card"]')[0]!.element
    dragged.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 130 }))
    await tick(0)

    // The dragged card carries the live delta…
    expect(cards[0]!.props('offsetX')).toBe(50)
    expect(cards[0]!.props('offsetY')).toBe(30)
    // …the untouched card stays at a constant 0/0…
    expect(cards[1]!.props('offsetX')).toBe(0)
    expect(cards[1]!.props('offsetY')).toBe(0)

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 160, clientY: 140 }))
    await tick(0)
    expect(cards[0]!.props('offsetX')).toBe(60)
    // …through EVERY move: props and rendered style never change.
    expect(cards[1]!.props('offsetX')).toBe(0)
    expect(cards[1]!.props('offsetY')).toBe(0)
    expect(idleEl.getAttribute('style')).toBe(idleStyleBefore)

    // Cancel so the in-progress gesture leaves no PUT behind.
    window.dispatchEvent(new MouseEvent('pointercancel'))
  })

  it('a dropped card holds its position until the cache catches up (no snap-back)', async () => {
    // Review fix 3: the gesture ends at pointerup but the commit (and its
    // optimistic cache write) lands ~150 ms later. The retained visual keeps
    // the transform applied meanwhile, and the delta self-zeroes the moment
    // the optimistic write arrives — the card never shows the OLD spot again.
    vi.useFakeTimers()
    const stored = [note('n1', { positionX: 10, positionY: 20 })]
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      // Hanging PUT: nothing ever settles, so ONLY the cache path can move
      // the card — exactly the window the flicker lived in.
      http.put(API_URLS.notes.detail('n1'), () => new Promise<Response>(() => {})),
    )

    const { wrapper } = await mountCanvas()
    await tick(300)

    const card = wrapper.find('[data-testid="post-it-card"]').element as HTMLElement
    card.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 130 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    await tick(0)

    // Gesture over, commit still debounced: the DROP position is what shows.
    expect(card.style.left).toBe('10px')
    expect(card.style.transform).toMatch(/^translate3d\(50px, 30px, 0(px)?\)$/)

    // The debounce fires and the optimistic write lands: left/top take over,
    // the transform is gone — pixel-identical, no jump through the old spot.
    await tick(200)
    expect(card.style.left).toBe('60px')
    expect(card.style.top).toBe('50px')
    expect(card.style.transform).toBe('')
  })

  it('pointercancel ends the drag WITHOUT committing and clears the transform', async () => {
    // Review fix 6b: a cancelled gesture is not a user-intended position.
    vi.useFakeTimers()
    stubNotes([note('n1', { positionX: 10, positionY: 20 })])

    const { wrapper } = await mountCanvas()
    await tick(300)

    const card = wrapper.find('[data-testid="post-it-card"]').element as HTMLElement
    card.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 130 }))
    await tick(0)
    expect(card.style.transform).toMatch(/translate3d/)

    window.dispatchEvent(new MouseEvent('pointercancel'))
    await tick(500)

    // Zero PUTs and no transform stuck on the card.
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(0)
    expect(card.style.transform).toBe('')
    expect(card.style.left).toBe('10px')
  })

  it('double-clicking another note mid-save swaps the editor and survives the old save settling', async () => {
    // Review fix SF-1: dblclick A → save (PUT in flight) → dblclick B must
    // show B's FRESH form (keyed remount), and A's post-await closeEditor
    // must NOT kill B's editor.
    const stored = [note('n1', { content: 'Hello' }), note('n2', { content: 'Second' })]
    let releasePut!: (response: Response) => void
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      http.put(API_URLS.notes.detail('n1'), () => {
        const merged = { ...stored[0]!, content: 'Edited A' }
        stored[0] = merged
        return new Promise<Response>((resolve) => {
          releasePut = resolve
        })
      }),
    )

    const { wrapper } = await mountCanvas()
    await settle()

    await wrapper.findAll('[data-testid="post-it-card"]')[0]!.trigger('dblclick')
    await flushPromises()
    await wrapper.find('[data-testid="note-editor-content"]').setValue('Edited A')
    await wrapper.find('[data-testid="note-editor-content"]').trigger('keydown', { key: 'Enter' })
    await settle()
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)

    // Switch to B WHILE A's PUT is in flight.
    await wrapper.findAll('[data-testid="post-it-card"]')[1]!.trigger('dblclick')
    await flushPromises()
    const textarea = wrapper.find('[data-testid="note-editor-content"]').element as HTMLTextAreaElement
    expect(textarea.value).toBe('Second')

    // A's save finally settles: B's editor STAYS OPEN with B's content.
    releasePut(HttpResponse.json(stored[0]!))
    await settle()
    expect(wrapper.find('[data-testid="note-editor"]').exists()).toBe(true)
    expect(
      (wrapper.find('[data-testid="note-editor-content"]').element as HTMLTextAreaElement).value,
    ).toBe('Second')
    // And it is NOT stuck in A's saving state.
    expect(wrapper.find('[data-testid="note-editor-content"]').attributes('disabled')).toBeUndefined()
  })

  it('a canvas double-click at the SAME pixel replaces the draft with a fresh empty editor', async () => {
    // Review fix 6c: the position-keyed draft did NOT remount when the second
    // dblclick landed on the identical point, keeping typed text. The nonce
    // key makes EVERY open fresh.
    stubNotes([])

    const { wrapper } = await mountCanvas()
    await settle()

    await dblClickCanvas(wrapper, 120, 80)
    await wrapper.find('[data-testid="note-draft-content"]').setValue('Typed text')
    await dblClickCanvas(wrapper, 120, 80)

    expect(wrapper.findAll('[data-testid="note-draft"]')).toHaveLength(1)
    const textarea = wrapper.find('[data-testid="note-draft-content"]').element as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('dragging the note currently being edited starts no drag (zero PUTs)', async () => {    vi.useFakeTimers()
    const { putBodies } = stubNotes([note('n1')])

    const { wrapper } = await mountCanvas()
    await tick(300)

    wrapper.find('[data-testid="post-it-card"]').element.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 10, clientY: 10 }),
    )
    await tick(50)
    expect(wrapper.find('[data-testid="note-editor"]').exists()).toBe(true)

    const card = wrapper.find('[data-testid="post-it-card"]').element
    card.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 130 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    await tick(500)

    // Contract honored: no drag, no commit, no PUT while the note is edited.
    expect(putBodies).toHaveLength(0)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(0)
  })

  it('a failed drag rolls the position back and toasts once (canvas wiring)', async () => {
    // Acceptance criterion "failed drag rolls back + toast" through the REAL
    // gesture path: endDrag → debounced commit → useUpdateNote failure cycle.
    vi.useFakeTimers()
    const stored = [note('n1', { positionX: 10, positionY: 20 })]
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(stored)),
      http.put(API_URLS.notes.detail('n1'), () =>
        HttpResponse.json({ status: 403, detail: 'viewer' }, { status: 403 }),
      ),
    )

    const { wrapper } = await mountCanvas()
    await tick(300)

    const card = wrapper.find('[data-testid="post-it-card"]').element
    card.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 130 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    await tick(500)

    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    // Snapshot restored: the cache carries the ORIGINAL spot, not the dropped 60/50.
    const cached = queryClient.getQueryData<NoteDto[]>(notesKeys.list(BOARD))
    expect(cached?.map((item) => [item.positionX, item.positionY])).toEqual([[10, 20]])
    // The fire-and-forget catch kept the rejection out of the void: one toast only.
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe("You don't have permission for this action")
    // Review fix 3 (rollback branch): the retained visual settled away with
    // the failure — no stuck transform, the card TRUTHFULLY shows the
    // restored old position.
    const el = card as HTMLElement
    expect(el.style.transform).toBe('')
    expect(el.style.left).toBe('10px')
    expect(el.style.top).toBe('20px')
  })

  it('picking a palette color and saving sends it in the full PUT body', async () => {
    // Acceptance criterion "edit note content AND color" end-to-end: the
    // swatch click flows ColorPicker → editor field → save → PUT body.
    const { stored, putBodies } = stubNotes([note('n1', { content: 'Hello' })])

    const { wrapper } = await mountCanvas()
    await settle()

    await wrapper.find('[data-testid="post-it-card"]').trigger('dblclick')
    await flushPromises()
    const teal = wrapper
      .findAll('[data-testid="color-swatch"]')
      .find((swatch) => swatch.attributes('aria-label') === 'note-teal')!
    await teal.trigger('click')
    await wrapper.find('[data-testid="note-editor-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    expect(putBodies).toHaveLength(1)
    expect(putBodies[0]).toEqual({
      content: 'Hello',
      color: 'note-teal',
      positionX: 10,
      positionY: 20,
    })
    expect(stored[0]!.color).toBe('note-teal')
    // The card repaints from the palette map with the saved token.
    expect(wrapper.find('[data-testid="post-it-card"]').attributes('style')).toContain(
      'rgb(160, 238, 228)', // NOTE_COLORS['note-teal']
    )
  })

  it('allows an Editor to create, edit, delete, and drag notes', async () => {
    const { stored, postBodies, putBodies } = stubNotes([note('n1')])
    server.use(
      http.get(MEMBERS_URL, () =>
        HttpResponse.json([
          {
            userId: 'u1',
            email: 'a@b.co',
            displayName: 'Ada',
            role: 'Editor',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ]),
      ),
    )

    const { wrapper } = await mountCanvas()
    await settle()
    expect(wrapper.findComponent(PostItCard).props('readOnly')).toBe(false)

    await dblClickCanvas(wrapper, 120, 80)
    await wrapper.find('[data-testid="note-draft-content"]').setValue('Editor-created')
    await wrapper.find('[data-testid="note-draft-content"]').trigger('keydown', { key: 'Enter' })
    await settle()

    expect(postBodies).toHaveLength(1)
    expect(stored.map((item) => item.content)).toEqual(['Hello', 'Editor-created'])
    expect(wrapper.findAllComponents(PostItCard).every((card) => card.props('readOnly') === false)).toBe(true)

    await wrapper.find('[data-note-id="n1"]').trigger('dblclick')
    await wrapper.find('[data-testid="note-editor-content"]').setValue('Editor-edited')
    await wrapper.find('[data-testid="note-editor-content"]').trigger('keydown', { key: 'Enter' })
    await settle()
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(1)
    expect(stored[0]!.content).toBe('Editor-edited')

    await wrapper.find('[data-note-id="n2"] [data-testid="post-it-card-delete"]').trigger('click')
    await settle()
    expect(callsTo(API_URLS.notes.detail('n2'), 'DELETE')).toHaveLength(1)
    expect(stored.map((item) => item.id)).toEqual(['n1'])

    vi.useFakeTimers()
    const card = wrapper.find('[data-note-id="n1"]').element as HTMLElement
    card.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 130 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    await tick(300)

    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(2)
    expect(putBodies[1]).toEqual({
      content: 'Editor-edited',
      color: 'note-yellow',
      positionX: 60,
      positionY: 50,
    })
  })

  it.each(['Viewer', 'Unknown'])(
    'keeps notes read-only for a current %s role, including stale card events',
    async (role) => {
      stubNotes([note('n1')])
      server.use(
        http.get(MEMBERS_URL, () =>
          HttpResponse.json([
            {
              userId: 'u1',
              email: 'a@b.co',
              displayName: 'Ada',
              role,
              createdAt: '2026-01-01T00:00:00Z',
            },
          ]),
        ),
      )

      const { wrapper } = await mountCanvas()
      await settle()

      const card = wrapper.findComponent(PostItCard)
      expect(card.props('readOnly')).toBe(true)
      await dblClickCanvas(wrapper, 120, 80)
      await wrapper.find('[data-testid="post-it-card"]').trigger('dblclick')
      card.vm.$emit('edit', 'n1')
      card.vm.$emit('delete', 'n1')
      card.vm.$emit('pointerdown-drag', {
        noteId: 'n1',
        event: new MouseEvent('pointerdown') as PointerEvent,
      })
      window.dispatchEvent(new MouseEvent('pointerup'))
      await settle()

      expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="note-editor"]').exists()).toBe(false)
      expect(callsTo(LIST_URL, 'POST')).toHaveLength(0)
      expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(0)
      expect(callsTo(API_URLS.notes.detail('n1'), 'DELETE')).toHaveLength(0)
    },
  )

  it.each(['pending', 'failed'])(
    'fails closed for a %s current-role query',
    async (state) => {
      stubNotes([note('n1')])
      if (state === 'pending') {
        server.use(http.get(MEMBERS_URL, () => new Promise<Response>(() => {})))
      } else {
        server.use(http.get(MEMBERS_URL, () => HttpResponse.json({ status: 500 }, { status: 500 })))
      }

      const { wrapper } = await mountCanvas()
      await settle()

      const card = wrapper.findComponent(PostItCard)
      expect(card.props('readOnly')).toBe(true)
      await dblClickCanvas(wrapper, 120, 80)
      card.vm.$emit('edit', 'n1')
      card.vm.$emit('delete', 'n1')
      card.vm.$emit('pointerdown-drag', {
        noteId: 'n1',
        event: new MouseEvent('pointerdown') as PointerEvent,
      })
      window.dispatchEvent(new MouseEvent('pointerup'))
      await settle()

      expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="note-editor"]').exists()).toBe(false)
      expect(callsTo(LIST_URL, 'POST')).toHaveLength(0)
      expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(0)
      expect(callsTo(API_URLS.notes.detail('n1'), 'DELETE')).toHaveLength(0)
    },
  )

  it('fails closed while a cached current role is being refetched', async () => {
    stubNotes([note('n1')])
    queryClient.setQueryData(membersKeys.list(BOARD), [
      {
        userId: 'u1',
        email: 'a@b.co',
        displayName: 'Ada',
        role: 'Owner',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])
    server.use(http.get(MEMBERS_URL, () => new Promise<Response>(() => {})))

    const { wrapper } = await mountCanvas()
    await settle()

    const card = wrapper.findComponent(PostItCard)
    expect(callsTo(MEMBERS_URL, 'GET')).toHaveLength(1)
    expect(card.props('readOnly')).toBe(true)
    await dblClickCanvas(wrapper, 120, 80)
    card.vm.$emit('edit', 'n1')
    card.vm.$emit('delete', 'n1')
    card.vm.$emit('pointerdown-drag', {
      noteId: 'n1',
      event: new MouseEvent('pointerdown') as PointerEvent,
    })
    window.dispatchEvent(new MouseEvent('pointerup'))
    await settle()

    expect(wrapper.find('[data-testid="note-draft"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="note-editor"]').exists()).toBe(false)
    expect(callsTo(LIST_URL, 'POST')).toHaveLength(0)
    expect(callsTo(API_URLS.notes.detail('n1'), 'PUT')).toHaveLength(0)
    expect(callsTo(API_URLS.notes.detail('n1'), 'DELETE')).toHaveLength(0)
  })
})
