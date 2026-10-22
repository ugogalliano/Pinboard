import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, ref } from 'vue'

import { notesKeys } from './useNotes'
import { useNotesRealtime } from './useNotesRealtime'
import type { NoteDto } from '@/shared/types/api'

// The transport is mocked wholesale (AGENTS §6: the real socket is not
// unit-tested here). The registered callbacks are captured from the on* mock
// calls, so tests dispatch hub events by invoking them directly.
const hub = vi.hoisted(() => ({
  connectBoardHub: vi.fn<() => Promise<void>>(async () => {}),
  joinBoard: vi.fn<(boardId: string) => Promise<void>>(async () => {}),
  leaveBoard: vi.fn<(boardId: string) => Promise<void>>(async () => {}),
  stopBoardHub: vi.fn<() => Promise<void>>(async () => {}),
  onNoteCreated: vi.fn<(listener: (note: NoteDto) => void) => void>(),
  offNoteCreated: vi.fn<(listener: (note: NoteDto) => void) => void>(),
  onNoteUpdated: vi.fn<(listener: (note: NoteDto) => void) => void>(),
  offNoteUpdated: vi.fn<(listener: (note: NoteDto) => void) => void>(),
  onNoteDeleted: vi.fn<(listener: (noteId: string) => void) => void>(),
  offNoteDeleted: vi.fn<(listener: (noteId: string) => void) => void>(),
}))
vi.mock('@/shared/services/signalr', () => hub)

const BOARD = 'b1'
const OTHER_BOARD = 'b2'

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

/** The callback the LAST mount registered for the given on* mock. */
function lastHandler<T>(mock: { mock: { calls: unknown[][] } }): T {
  const calls = mock.mock.calls
  return calls[calls.length - 1]![0] as T
}

const createdCb = () => lastHandler<(note: NoteDto) => void>(hub.onNoteCreated)
const updatedCb = () => lastHandler<(note: NoteDto) => void>(hub.onNoteUpdated)
const deletedCb = () => lastHandler<(noteId: string) => void>(hub.onNoteDeleted)

describe('useNotesRealtime', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  function mountComposable(boardId: string) {
    const Harness = defineComponent({
      setup() {
        useNotesRealtime(boardId)
        return () => h('div')
      },
    })
    return mount(Harness, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } })
  }

  function seed(notes: NoteDto[]): void {
    queryClient.setQueryData(notesKeys.list(BOARD), notes)
  }

  function cached(): NoteDto[] {
    return queryClient.getQueryData<NoteDto[]>(notesKeys.list(BOARD)) ?? []
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────
  it('connects, joins and registers the three handlers on mount', () => {
    mountComposable(BOARD)

    expect(hub.connectBoardHub).toHaveBeenCalledTimes(1)
    expect(hub.joinBoard).toHaveBeenCalledWith(BOARD)
    expect(hub.onNoteCreated).toHaveBeenCalledTimes(1)
    expect(hub.onNoteUpdated).toHaveBeenCalledTimes(1)
    expect(hub.onNoteDeleted).toHaveBeenCalledTimes(1)
  })

  it('leaves and unregisters handlers on unmount, keeping the connection alive', () => {
    const wrapper = mountComposable(BOARD)
    const created = createdCb()
    const updated = updatedCb()
    const deleted = deletedCb()

    wrapper.unmount()

    expect(hub.leaveBoard).toHaveBeenCalledWith(BOARD)
    expect(hub.offNoteCreated).toHaveBeenCalledWith(created)
    expect(hub.offNoteUpdated).toHaveBeenCalledWith(updated)
    expect(hub.offNoteDeleted).toHaveBeenCalledWith(deleted)
    // PLAN §11: the shared connection is NOT stopped on unmount.
    expect(hub.stopBoardHub).not.toHaveBeenCalled()
  })

  it('swallows connect failures — mounting the canvas never crashes', async () => {
    hub.connectBoardHub.mockRejectedValueOnce(new Error('raw transport error'))

    expect(() => mountComposable(BOARD)).not.toThrow()
    // The rejection must not surface anywhere (M-1); handlers still wire up.
    await Promise.resolve()
    expect(hub.onNoteCreated).toHaveBeenCalledTimes(1)
  })

  it('no-ops on an empty board id — no connect, no join, no handlers', () => {
    mountComposable('')

    expect(hub.connectBoardHub).not.toHaveBeenCalled()
    expect(hub.joinBoard).not.toHaveBeenCalled()
    expect(hub.onNoteCreated).not.toHaveBeenCalled()
  })

  it('normalizes array route params to the first id', () => {
    const Harness = defineComponent({
      setup() {
        // Route params can arrive as string[] — the guard normalizes them.
        useNotesRealtime(ref([BOARD, OTHER_BOARD] as unknown as string))
        return () => h('div')
      },
    })
    mount(Harness, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } })

    expect(hub.joinBoard).toHaveBeenCalledWith(BOARD)
  })

  // ── PostItCreated ───────────────────────────────────────────────────────
  it('created appends to the cached list, preserving other identities', () => {
    mountComposable(BOARD)
    const n1 = note('n1')
    seed([n1])

    createdCb()(note('n2'))

    const list = cached()
    expect(list.map((item) => item.id)).toEqual(['n1', 'n2'])
    expect(list[0]).toBe(n1)
  })

  it('created dedupes by id — a self-echo of an optimistic create never duplicates', () => {
    mountComposable(BOARD)
    seed([note('n1')])
    const setSpy = vi.spyOn(queryClient, 'setQueryData')

    createdCb()(note('n1', { content: 'echo' }))

    expect(setSpy).not.toHaveBeenCalled()
    expect(cached()).toHaveLength(1)
  })

  it('created invalidates the exact key when no cache entry exists', () => {
    mountComposable(BOARD)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    createdCb()(note('n1'))

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: notesKeys.list(BOARD),
      exact: true,
    })
    expect(cached()).toHaveLength(0)
  })

  // ── PostItUpdated ───────────────────────────────────────────────────────
  it('updated replaces the touched entry only, server payload authoritative', () => {
    mountComposable(BOARD)
    const n1 = note('n1')
    const n2 = note('n2')
    seed([n1, n2])

    const updatedNote = { ...n2, content: 'Remote edit' }
    updatedCb()(updatedNote)

    const list = cached()
    // The touched entry carries the server payload. (vue-query's structural
    // sharing may hand back a deep-equal re-copy of CHANGED entries — its
    // identity guarantee is for UNTOUCHED items, asserted next.)
    expect(list[1]).toEqual(updatedNote)
    expect(list[0]).toBe(n1)
  })

  it('updated invalidates when the id is not in the cache', () => {
    mountComposable(BOARD)
    seed([note('n1')])
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    updatedCb()(note('ghost'))

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: notesKeys.list(BOARD),
      exact: true,
    })
  })

  it('updated invalidates when no cache entry exists', () => {
    mountComposable(BOARD)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    updatedCb()(note('n1'))

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: notesKeys.list(BOARD),
      exact: true,
    })
  })

  // ── PostItDeleted ───────────────────────────────────────────────────────
  it('deleted filters the id out of the cached list', () => {
    mountComposable(BOARD)
    const n2 = note('n2')
    seed([note('n1'), n2])

    deletedCb()('n1')

    const list = cached()
    expect(list.map((item) => item.id)).toEqual(['n2'])
    // Content check, not identity: structural sharing re-copies entries whose
    // INDEX shifted, so only index-aligned untouched items keep their
    // reference (see the updated-replaces test).
    expect(list[0]).toEqual(n2)
  })

  it('deleted no-ops when the id is absent from the cache', () => {
    mountComposable(BOARD)
    const n1 = note('n1')
    seed([n1])
    const setSpy = vi.spyOn(queryClient, 'setQueryData')

    deletedCb()('ghost')

    expect(setSpy).not.toHaveBeenCalled()
    expect(cached()).toEqual([n1])
  })

  it('deleted invalidates when no cache entry exists', () => {
    mountComposable(BOARD)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    deletedCb()('n1')

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: notesKeys.list(BOARD),
      exact: true,
    })
  })

  // ── Board scoping + malformed payloads (I-d) ────────────────────────────
  it('ignores created/updated events belonging to another board', () => {
    mountComposable(BOARD)
    seed([note('n1')])
    const setSpy = vi.spyOn(queryClient, 'setQueryData')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    createdCb()(note('x1', { boardId: OTHER_BOARD }))
    updatedCb()(note('n1', { boardId: OTHER_BOARD }))

    expect(setSpy).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(cached()).toHaveLength(1)
  })

  it('tolerates malformed payloads — no throw into the dispatch loop', () => {
    mountComposable(BOARD)
    seed([note('n1')])
    const setSpy = vi.spyOn(queryClient, 'setQueryData')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const bad = createdCb() as unknown as (value: unknown) => void
    const badUpdated = updatedCb() as unknown as (value: unknown) => void
    const badDeleted = deletedCb() as unknown as (value: unknown) => void

    expect(() => bad(null)).not.toThrow()
    expect(() => bad({ boardId: BOARD })).not.toThrow() // missing id
    expect(() => bad({ id: 42, boardId: BOARD })).not.toThrow() // odd id
    expect(() => badUpdated(undefined)).not.toThrow()
    expect(() => badDeleted(null)).not.toThrow()
    expect(() => badDeleted(7)).not.toThrow()

    expect(setSpy).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
