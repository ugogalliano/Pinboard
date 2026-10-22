import { useQueryClient } from '@tanstack/vue-query'
import { onBeforeUnmount, onMounted, type MaybeRef } from 'vue'

import { normalizeRouteId } from '@/shared/composables/normalizeRouteId'
import {
  connectBoardHub,
  joinBoard,
  leaveBoard,
  offNoteCreated,
  offNoteDeleted,
  offNoteUpdated,
  onNoteCreated,
  onNoteDeleted,
  onNoteUpdated,
} from '@/shared/services/signalr'
import type { NoteDto } from '@/shared/types/api'
import { notesKeys } from './useNotes'

// Phase 7 realtime wiring (PLAN.FE.md §11): the ONLY place the hub touches
// the notes cache. Handlers write straight through `setQueryData` — never a
// refetch — and invalidation is the fallback for unknown/partial state only
// (AGENTS.md §8: "handlers write straight into the query cache"). The boardId
// is resolved and normalized ONCE here and captured in the handler closures,
// so an event can only ever write its own board's key, and nothing from
// another board (or the `['boards']` namespace) is ever touched.
//
// Hub payloads come from the server UNVALIDATED (transport forwards them as
// received), so every handler first tolerates malformed shapes: a
// created/updated note whose `id` is missing or whose `boardId` does not
// match the wired board is ignored, and a non-string deleted payload is
// ignored — never throw into the SignalR dispatch loop.

/** Runtime guard for a hub note payload: usable id, and scoped to this board. */
function isNoteForBoard(note: unknown, boardId: string): note is NoteDto {
  if (!note || typeof note !== 'object') return false
  const candidate = note as Partial<NoteDto>
  return typeof candidate.id === 'string' && candidate.id !== '' && candidate.boardId === boardId
}

/**
 * Subscribes the `['boards', boardId, 'notes']` cache to the board hub:
 * connects and joins on mount, leaves and unregisters on unmount (the
 * connection itself STAYS alive — shared across boards and remounts).
 * No-op when the board id is empty/undefined (the route param may also
 * arrive as an array — `normalizeRouteId` handles it).
 */
export function useNotesRealtime(boardId: MaybeRef<string>): void {
  const queryClient = useQueryClient()

  const id = normalizeRouteId(boardId) ?? ''
  if (!id) return

  const key = notesKeys.list(id)

  /** PLAN §11 fallback: refetch owns first load / unknown or partial state. */
  function invalidateList(): void {
    void queryClient.invalidateQueries({ queryKey: key, exact: true })
  }

  function onCreated(note: NoteDto): void {
    if (!isNoteForBoard(note, id)) return
    const list = queryClient.getQueryData<NoteDto[]>(key)
    if (!list) {
      invalidateList()
      return
    }
    // Self-echo guard: an optimistic create has already swapped the real DTO
    // in (onSuccess/onSettled) — never append a duplicate id.
    if (list.some((item) => item.id === note.id)) return
    // Identity-preserving append: untouched cards keep their object identity.
    queryClient.setQueryData(key, [...list, note])
  }

  function onUpdated(note: NoteDto): void {
    if (!isNoteForBoard(note, id)) return
    const list = queryClient.getQueryData<NoteDto[]>(key)
    if (!list || !list.some((item) => item.id === note.id)) {
      invalidateList()
      return
    }
    // Server payload is authoritative; clone ONLY the touched entry.
    queryClient.setQueryData(
      key,
      list.map((item) => (item.id === note.id ? note : item)),
    )
  }

  function onDeleted(noteId: string): void {
    // Payload is a bare noteId (group membership scopes it to this board),
    // but it is still unvalidated — ignore anything that is not a string.
    if (typeof noteId !== 'string') return
    const list = queryClient.getQueryData<NoteDto[]>(key)
    if (!list) {
      invalidateList()
      return
    }
    if (!list.some((item) => item.id === noteId)) return
    // Identity-preserving filter; absent ids never rewrite the cache.
    queryClient.setQueryData(
      key,
      list.filter((item) => item.id !== noteId),
    )
  }

  onMounted(() => {
    // M-1 (Task 1 review) / Important-2 (final review): the rejection is
    // swallowed but leaves ONE non-user-facing trace — a fixed marker only,
    // never the error message/token/URL (AGENTS.md §7). The transport's
    // watchdog retries; the connection-state indicator is the user-facing
    // affordance. A failed connect must not crash the mount.
    void connectBoardHub().catch(() => {
      console.debug('[notes-realtime] board hub connect failed; watchdog retries')
    })
    // joinBoard records the board even while Connecting and the transport
    // flushes it when the connection opens (or re-opens).
    void joinBoard(id).catch(() => {})
    onNoteCreated(onCreated)
    onNoteUpdated(onUpdated)
    onNoteDeleted(onDeleted)
  })

  onBeforeUnmount(() => {
    // Release ONLY this board's subscription and this instance's handlers;
    // the shared connection stays alive per PLAN §11.
    void leaveBoard(id).catch(() => {})
    offNoteCreated(onCreated)
    offNoteUpdated(onUpdated)
    offNoteDeleted(onDeleted)
  })
}
