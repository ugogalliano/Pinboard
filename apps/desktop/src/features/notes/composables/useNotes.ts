import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { useToast } from '@ugogalliano/pm-design-system-vue'
import { computed, toValue, type MaybeRef } from 'vue'

import { apiClient, mapApiErrorToMessage } from '@/shared/services/api'
import { HTTP_METHODS } from '@/shared/constants/constants'
import { API_URLS } from '@/shared/constants/urls'
import { normalizeRouteId } from '@/shared/composables/normalizeRouteId'
import { useAuthStore } from '@/stores/authStore'
import type { CreateNoteRequest, NoteDto, UpdateNoteRequest } from '@/shared/types/api'

/**
 * Notes query keys — the single source of truth for the notes namespace
 * (AGENTS.md §2). Deliberately PLAIN arrays / functions taking an id: the
 * positional `setQueryData` / `getQueryData` / `cancelQueries` overloads do
 * NOT unwrap getter-style entries (`() => id`), so a reactive factory here
 * would write to a different key than observers subscribe to.
 *
 * The namespace `['boards', boardId, 'notes']` mirrors PLAN.FE.md §8. The
 * keys stay LOCAL to this feature (not folded into boardsKeys) because the
 * Phase 7 SignalR wiring lives here and `shared/services` must never import
 * from `features/` — keeping the factories next to their only consumer
 * preserves that dependency direction.
 *
 * Only `list` exists — there is deliberately NO `all`/namespace key: a
 * `['boards']`-style parent key would be misleading (boards' own list lives
 * there too) and invites non-exact prefix invalidations that stale unrelated
 * caches on every note drag.
 *
 * Every invalidation issued from this file passes `exact: true`: a non-exact
 * prefix match on `['boards', boardId]` would also stale the `['boards']`
 * list / `['boards', id]` detail and the future
 * `['boards', id, 'members']` caches on every note drag.
 */
export const notesKeys = {
  list: (boardId: string) => ['boards', boardId, 'notes'] as const,
}

/** Values accepted by the create mutation (mirrors `CreateNoteRequest`). */
export type CreateNoteValues = CreateNoteRequest

/**
 * Values accepted by the update mutation (the id rides along the payload).
 * A field that is OMITTED keeps its freshest cached value (see
 * `useUpdateNote`): drag commits send positions only, editor saves send
 * content/color only, so neither can clobber the other with a stale snapshot.
 */
export type UpdateNoteValues = { id: string } & Partial<UpdateNoteRequest>

/** Values accepted by the delete mutation. */
export type DeleteNoteValues = { noteId: string }

/** Context returned by the create `onMutate`, consumed by swap/rollback. */
interface CreateNoteContext {
  previous: NoteDto[] | undefined
  tempId: string
}

/** Snapshot context shared by the update / delete `onMutate` hooks. */
interface NoteSnapshot {
  previous: NoteDto[] | undefined
}

/**
 * GET /api/boards/{boardId}/notes → every note pinned on the board behind
 * the `:boardId` route param. `normalizeRouteId` + the `enabled` guard match
 * `useBoard`: a param-less route means no fetch and a still-pending query.
 * No `keepPreviousData` here — the payload is an array, and the canvas has no
 * meaningful "keep the old board's notes on screen" state to preserve.
 */
export function useNotesQuery(boardId: MaybeRef<string | string[] | undefined>) {
  const id = computed(() => normalizeRouteId(boardId))

  return useQuery({
    queryKey: computed(() => notesKeys.list(id.value ?? '')),
    queryFn: () =>
      apiClient<NoteDto[]>(HTTP_METHODS.GET, API_URLS.notes.list(id.value ?? '')),
    enabled: () => id.value !== undefined,
  })
}

/**
 * POST /api/boards/{boardId}/notes — editor-first create. The canvas
 * double-click opens a LOCAL draft only (step 2); this mutation fires on SAVE
 * with real content (PLAN.FE.md §19 "create (double-click)" + the
 * spawn-at-cursor decision: `positionX/Y` arrive pre-filled by the caller).
 * While the POST is in flight a TEMP note (id `temp-…`, `createdBy` the
 * current user) rides in the cache so the canvas feels instant; `onSuccess`
 * swaps it for the authoritative DTO and `onError` restores the snapshot.
 */
export function useCreateNote(boardId: MaybeRef<string>) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const auth = useAuthStore()

  return useMutation({
    mutationFn: (values: CreateNoteValues) =>
      apiClient<NoteDto>(HTTP_METHODS.POST, API_URLS.notes.list(toValue(boardId)), values),
    onMutate: async (values) => {
      const key = notesKeys.list(toValue(boardId))
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<NoteDto[]>(key)
      const tempId = `temp-${crypto.randomUUID()}`
      const now = new Date().toISOString()
      const temp: NoteDto = {
        id: tempId,
        boardId: toValue(boardId),
        createdBy: auth.user?.id ?? null,
        content: values.content,
        color: values.color,
        positionX: values.positionX,
        positionY: values.positionY,
        createdAt: now,
        updatedAt: now,
      }
      // Identity-preserving append: `[...previous, temp]` clones only the NEW
      // item — untouched notes keep their object identity, so cards bound to
      // them do not re-render on someone else's create (AGENTS.md §8).
      queryClient.setQueryData(key, previous ? [...previous, temp] : [temp])
      return { previous, tempId } satisfies CreateNoteContext
    },
    onSuccess: (created, _values, context) => {
      if (!created) return
      const key = notesKeys.list(toValue(boardId))
      const notes = queryClient.getQueryData<NoteDto[]>(key)
      if (!notes) {
        queryClient.setQueryData(key, [created])
        return
      }
      // Idempotent swap: replace the temp entry captured in onMutate — or,
      // if a refetch already landed the real note (temp gone), append it
      // ONLY when its id is still absent. A duplicate is never possible.
      if (notes.some((item) => item.id === context?.tempId)) {
        queryClient.setQueryData(
          key,
          notes.map((item) => (item.id === context?.tempId ? created : item)),
        )
      } else if (!notes.some((item) => item.id === created.id)) {
        queryClient.setQueryData(key, [...notes, created])
      }
    },
    onError: (err, _values, context) => {
      const key = notesKeys.list(toValue(boardId))
      if (context) {
        if (context.previous) {
          queryClient.setQueryData(key, context.previous)
        } else {
          // Nothing to roll back TO: drop the optimistically seeded list so
          // the temp note cannot outlive the failed create.
          queryClient.removeQueries({ queryKey: key, exact: true })
        }
      }
      toast({ variant: 'error', message: mapApiErrorToMessage(err) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: notesKeys.list(toValue(boardId)),
        exact: true,
      })
    },
  })
}

/**
 * PUT /api/notes/{id} — the SINGLE owner of note updates (drag commits and
 * editor saves both route through it; `useDragNote` never defines its own
 * mutation). The wire body is always the FULL `UpdateNoteRequest`: it is
 * rebuilt from the freshest cache entry at mutate time, which protects a
 * content edit from being clobbered by a drag that snapshotted older state
 * (perf review P-freshest). `boardId` rides the hook because the PUT URL
 * carries none and the optimistic cache key needs it.
 * Viewer 403s need no special handling: they surface through the standard
 * rollback + toast mapping like every other failure.
 */
export function useUpdateNote(boardId: MaybeRef<string>) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (values: UpdateNoteValues) => {
      // Read the cache AFTER the optimistic merge below: it is the freshest
      // view of this note (own changes included, untouched fields taken from
      // the latest entry, not from the caller's possibly stale snapshot).
      const latest = queryClient
        .getQueryData<NoteDto[]>(notesKeys.list(toValue(boardId)))
        ?.find((item) => item.id === values.id)
      const body: UpdateNoteRequest = {
        content: values.content ?? latest?.content ?? '',
        color: values.color ?? latest?.color ?? '',
        positionX: values.positionX ?? latest?.positionX ?? 0,
        positionY: values.positionY ?? latest?.positionY ?? 0,
      }
      return apiClient<NoteDto>(HTTP_METHODS.PUT, API_URLS.notes.detail(values.id), body)
    },
    onMutate: async (values) => {
      const key = notesKeys.list(toValue(boardId))
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<NoteDto[]>(key)
      if (previous) {
        // Identity-preserving map: clone ONLY the touched note and merge the
        // incoming fields onto its freshest cached shape.
        queryClient.setQueryData(
          key,
          previous.map((item) => (item.id === values.id ? { ...item, ...values } : item)),
        )
      }
      return { previous } satisfies NoteSnapshot
    },
    onSuccess: (updated) => {
      if (!updated) return
      const key = notesKeys.list(toValue(boardId))
      const notes = queryClient.getQueryData<NoteDto[]>(key)
      if (!notes) return
      // The server response is authoritative (it may normalize the content).
      queryClient.setQueryData(
        key,
        notes.map((item) => (item.id === updated.id ? updated : item)),
      )
    },
    onError: (err, _values, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notesKeys.list(toValue(boardId)), context.previous)
      }
      toast({ variant: 'error', message: mapApiErrorToMessage(err) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: notesKeys.list(toValue(boardId)),
        exact: true,
      })
    },
  })
}

/**
 * DELETE /api/notes/{id} (204 → undefined) with the full optimistic cycle:
 * cancel in-flight reads, filter the note out immediately, restore the
 * snapshot + toast on failure, invalidate the exact list key when settled.
 * `boardId` rides the hook (the DELETE URL carries no board id, and both the
 * rollback and the invalidation need the cache key).
 */
export function useDeleteNote(boardId: MaybeRef<string>) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({ noteId }: DeleteNoteValues) =>
      apiClient<void>(HTTP_METHODS.DELETE, API_URLS.notes.detail(noteId)),
    onMutate: async ({ noteId }) => {
      const key = notesKeys.list(toValue(boardId))
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<NoteDto[]>(key)
      if (previous) {
        queryClient.setQueryData(
          key,
          previous.filter((item) => item.id !== noteId),
        )
      }
      return { previous } satisfies NoteSnapshot
    },
    onError: (err, _values, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notesKeys.list(toValue(boardId)), context.previous)
      }
      toast({ variant: 'error', message: mapApiErrorToMessage(err) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: notesKeys.list(toValue(boardId)),
        exact: true,
      })
    },
  })
}
