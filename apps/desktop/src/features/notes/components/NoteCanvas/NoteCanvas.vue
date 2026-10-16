<template>
  <div
    ref="surfaceRef"
    class="relative min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-canvas"
    data-testid="note-canvas"
    @dblclick="onCanvasDblClick"
  >
    <!-- Initial load only (same `isPending && isFetching` idiom as BoardList:
         a background refetch must not hide notes that are already on screen). -->
    <div
      v-if="isPending && isFetching"
      class="flex items-center justify-center py-10"
      data-testid="note-canvas-loading"
    >
      <Spinner label="Loading notes…" />
    </div>

    <div
      v-else-if="isError"
      class="m-6 flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-card p-6 text-center"
      data-testid="note-canvas-error"
    >
      <p class="text-sm text-muted-foreground">We couldn't load the notes on this board.</p>
      <Button variant="secondary" data-testid="note-canvas-retry" @click="retry">Try again</Button>
    </div>

    <div v-else class="relative" style="width: 3000px; height: 3000px">
      <p
        v-if="notes.length === 0"
        class="absolute left-10 top-10 max-w-sm text-sm text-muted-foreground"
        data-testid="note-canvas-empty"
      >
        {{
          canWriteNotes
            ? 'This board has no notes yet — double-click anywhere on the canvas to pin your first one.'
            : 'This board has no notes yet.'
        }}
      </p>

      <PostItCard
        v-for="note in notes"
        :key="note.id"
        :note="note"
        :editing="canWriteNotes && editingId === note.id"
        :dragging="canWriteNotes && draggingId === note.id"
        :read-only="!canWriteNotes"
        :offset-x="visibleOffset(note).x"
        :offset-y="visibleOffset(note).y"
        @edit="startEdit"
        @delete="onDelete"
        @pointerdown-drag="onCardPointerdownDrag"
      />

      <!-- Editor-first create: the draft is LOCAL (no request, no cache write)
           until a valid save fires useCreateNote at the double-click point.
           Keyed by a per-open NONCE so every canvas double-click REMOUNTS a
           fresh empty editor — even at the identical pixel (review fix).
           Only ever one draft, so duplicate temps are impossible. -->
      <PostItEditor
        v-if="draft && canWriteNotes"
        :key="`draft-${draft.nonce}`"
        test-id-prefix="note-draft"
        :initial-content="''"
        :initial-color="DEFAULT_COLOR"
        :position-x="draft.positionX"
        :position-y="draft.positionY"
        :saving="draftSaving"
        :server-error="draftError"
        :style="{ left: `${draft.positionX}px`, top: `${draft.positionY}px` }"
        @save="onDraftSave"
        @cancel="closeDraft"
      />

      <!-- Inline edit over an existing card. Keyed by id so switching notes
           (e.g. while a save is in flight) REMOUNTS a fresh form instead of
           showing the previous note's content (review fix: stale-form race). -->
      <PostItEditor
        v-else-if="editingNote && canWriteNotes"
        :key="editingNote.id"
        test-id-prefix="note-editor"
        :initial-content="editingNote.content"
        :initial-color="editorColor"
        :position-x="editingNote.positionX"
        :position-y="editingNote.positionY"
        :saving="editorSaving"
        :server-error="editorError"
        :style="{ left: `${editingNote.positionX}px`, top: `${editingNote.positionY}px` }"
        @save="onEditorSave"
        @cancel="closeEditor"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Button } from '@ugogalliano/pm-design-system-vue'

import Spinner from '@/shared/components/ui/Spinner/Spinner.vue'
import { isApiError, mapApiErrorToMessage } from '@/shared/services/api'
import { normalizeRouteId } from '@/shared/composables/normalizeRouteId'
import { NOTE_COLOR_NAMES, type NoteColor } from '@/shared/constants/note-colors'
import { useCurrentBoardRole } from '@/features/members'
import type { NoteDto } from '@/shared/types/api'
import PostItCard from '../PostItCard/PostItCard.vue'
import PostItEditor from '../PostItEditor/PostItEditor.vue'
import {
  useCreateNote,
  useDeleteNote,
  useNotesQuery,
  useUpdateNote,
} from '../../composables/useNotes'
import {
  clientToCanvas,
  useDragNote,
  type CanvasPoint,
  type DragPointer,
} from '../../composables/useDragNote'

// The board canvas (PLAN.FE.md §12 "Notes"): renders PostItCards from the
// `['boards', boardId, 'notes']` query and owns every write gesture —
// double-click draft create, inline edit, delete, drag. All server state
// flows through vue-query; mutation failures roll back + toast INSIDE the
// composables, so this component never toasts and never touches apiClient.

const DEFAULT_COLOR: NoteColor = 'note-yellow'

const route = useRoute()
const boardIdParam = computed(() => route.params.boardId)
/** Normalized once for the mutation hooks (the query normalizes internally). */
const boardId = computed(() => normalizeRouteId(boardIdParam.value) ?? '')
const currentRole = useCurrentBoardRole(boardIdParam)
const canWriteNotes = computed(
  () => currentRole.value === 'Owner' || currentRole.value === 'Editor',
)

const { data, isPending, isError, isFetching, refetch } = useNotesQuery(boardIdParam)
const notes = computed(() => data.value ?? [])

const { mutateAsync: createNote } = useCreateNote(boardId)
const { mutateAsync: updateNote } = useUpdateNote(boardId)
const { mutate: deleteNote } = useDeleteNote(boardId)

const { draggingId, dragOffset, pendingVisual, startDrag, onPointerMove, endDrag, cancelDrag } =
  useDragNote({ boardId })

/**
 * The transform delta a card should render (perf review fix): the LIVE
 * offset only for the card being dragged — never broadcast to all cards, so
 * a pointermove leaves the untouched cards' props unchanged (review fix 1).
 * A just-dropped card instead keeps a retained-`pendingVisual` delta applied
 * until its commit's optimistic write makes the delta zero, and the
 * composable clears the retention when the mutation settles — success keeps
 * the drop position, a failed drag snaps back to the restored old one
 * (review fix 3: no snap-back flicker during the debounce window).
 * Everyone else gets constant 0.
 */
function visibleOffset(note: NoteDto): CanvasPoint {
  if (draggingId.value === note.id) return dragOffset.value
  const pending = pendingVisual.value
  if (pending && pending.id === note.id) {
    return { x: pending.x - note.positionX, y: pending.y - note.positionY }
  }
  return { x: 0, y: 0 }
}

// ── Draft (editor-first create) ───────────────────────────────────────────
const surfaceRef = ref<HTMLElement | null>(null)
/** `nonce` bumps on EVERY open so the editor key remounts even at one pixel. */
const draft = ref<{ positionX: number; positionY: number; nonce: number } | null>(null)
let draftNonce = 0
const draftError = ref<string | null>(null)
const draftSaving = ref(false)

// ── Inline edit ───────────────────────────────────────────────────────────
const editingId = ref<string | null>(null)
const editorError = ref<string | null>(null)
const editorSaving = ref(false)

const editingNote = computed<NoteDto | null>(
  () => notes.value.find((note) => note.id === editingId.value) ?? null,
)

// A legacy/out-of-palette cached color would fail the schema's color enum and
// silently block saves; normalize it to the default so editing always works.
const editorColor = computed(() => {
  const color = editingNote.value?.color
  return color && NOTE_COLOR_NAMES.includes(color as NoteColor) ? color : DEFAULT_COLOR
})

function onCanvasDblClick(event: MouseEvent): void {
  // A card double-click never reaches here (`.stop` on the card); only a
  // genuine canvas gesture opens a draft.
  if (!canWriteNotes.value || isPending.value || isError.value || editingId.value !== null) return
  const surface = surfaceRef.value
  if (!surface) return
  const { x, y } = clientToCanvas(
    event.clientX,
    event.clientY,
    surface.getBoundingClientRect(),
    surface.scrollLeft,
    surface.scrollTop,
  )
  // Second double-click while a draft is open replaces it — the nonce-keyed
  // remount resets it to a fresh empty editor even at the SAME pixel —
  // still exactly ONE draft, so no duplicate temp notes are possible.
  draft.value = { positionX: x, positionY: y, nonce: ++draftNonce }
  draftError.value = null
}

function closeDraft(): void {
  draft.value = null
  draftError.value = null
}

async function onDraftSave(values: { content: string; color: string }): Promise<void> {
  if (!canWriteNotes.value) return
  const point = draft.value
  if (!point) return
  draftSaving.value = true
  draftError.value = null
  try {
    await createNote({
      content: values.content,
      color: values.color,
      positionX: point.positionX,
      positionY: point.positionY,
    })
    closeDraft()
  } catch (err) {
    // 400 detail → inline form-level message. The composable's onError toasts
    // EVERY failure — including this 400 (toast + inline, same precedent as
    // CreateBoardDialog). The draft STAYS OPEN either way for a retry.
    if (isApiError(err) && err.status === 400) {
      draftError.value = mapApiErrorToMessage(err)
    }
  } finally {
    draftSaving.value = false
  }
}

// ── Edit existing ─────────────────────────────────────────────────────────
function startEdit(noteId: string): void {
  // Restarting the SAME note would remount the editor and throw away typed
  // input — a no-op. Switching to a DIFFERENT note while a save is in
  // flight REPLACES cleanly instead of being refused: the in-flight save's
  // settle handlers below are guarded on their own id, so they can neither
  // close nor error this new editor (review fix SF-1: stale-form race).
  if (!canWriteNotes.value || editingId.value === noteId) return
  editingId.value = noteId
  editorError.value = null
  // The new note's editor starts not-saving; the previous save's `finally`
  // will not touch this flag (id guard), so resetting here is required.
  editorSaving.value = false
  draft.value = null
  draftError.value = null
}

function closeEditor(): void {
  editingId.value = null
  editorError.value = null
}

async function onEditorSave(values: { content: string; color: string }): Promise<void> {
  if (!canWriteNotes.value) return
  const savedId = editingId.value
  if (!savedId) return
  editorSaving.value = true
  editorError.value = null
  try {
    // Positions deliberately omitted: useUpdateNote rebuilds the full PUT
    // body from the freshest cache entry, so an edit never clobbers a
    // concurrent (or just-committed) drag.
    await updateNote({ id: savedId, content: values.content, color: values.color })
    // Only close THIS save's editor: if the user switched notes while the
    // PUT was in flight, leave the new editor open (review fix SF-1).
    if (editingId.value === savedId) closeEditor()
  } catch (err) {
    // 400 detail → inline form-level message. The composable's onError
    // ALSO toasts every failure (including this 400 — CreateBoardDialog
    // precedent: toast + inline, not either/or). Editor STAYS OPEN for retry.
    if (isApiError(err) && err.status === 400 && editingId.value === savedId) {
      editorError.value = mapApiErrorToMessage(err)
    }
  } finally {
    if (editingId.value === savedId) editorSaving.value = false
  }
}

// ── Delete ────────────────────────────────────────────────────────────────
// Optimistic remove + rollback + error toast all live in useDeleteNote.
function onDelete(noteId: string): void {
  if (!canWriteNotes.value) return
  deleteNote({ noteId })
}

// ── Drag wiring ───────────────────────────────────────────────────────────
function startNoteDrag(note: NoteDto, event: DragPointer): void {
  // Explicit contract: never start a drag on the note currently being edited.
  if (!canWriteNotes.value || editingId.value === note.id) return
  startDrag(note, event)
}

// The card's payload carries the note id (like edit/delete), so this stays a
// STABLE method ref: no per-card closure is re-created on every canvas
// render, which would change every card's `onPointerdownDrag` prop and force
// a full re-render mid-gesture (perf review fix).
function onCardPointerdownDrag(payload: { noteId: string; event: PointerEvent }): void {
  if (!canWriteNotes.value) return
  const note = notes.value.find((item) => item.id === payload.noteId)
  if (note) startNoteDrag(note, payload.event)
}

function handlePointerMove(event: PointerEvent): void {
  if (!canWriteNotes.value) {
    cancelDrag()
    return
  }
  onPointerMove(event)
}

function handlePointerUp(): void {
  if (!canWriteNotes.value) {
    cancelDrag()
    return
  }
  endDrag()
}

// A cancelled gesture (pointercancel: touch takeover, lost capture, OS
// interrupt) is NOT a user-intended position: reset the drag WITHOUT
// committing and drop any retained visual for the cancelled note.
function handlePointerCancel(): void {
  cancelDrag()
}

onMounted(() => {
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerCancel)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerCancel)
})

function retry(): void {
  void refetch()
}
</script>
