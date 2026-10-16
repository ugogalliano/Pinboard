<template>
  <div
    data-testid="post-it-card"
    :data-note-id="note.id"
    class="absolute w-56 rounded-md p-3 pb-8 shadow-md min-h-[150px]"
    :class="
      readOnly
        ? 'cursor-default'
        : dragging
        ? 'z-20 cursor-grabbing touch-none select-none will-change-transform'
        : 'cursor-grab transition-shadow hover:shadow-lg'
    "
    :style="cardStyle"
    draggable="false"
    @dblclick.stop="onEdit"
    @pointerdown="onPointerdownDrag"
  >
    <Button
      v-if="!editing && !readOnly"
      variant="ghost"
      class="absolute right-1 top-1 h-6 w-6 rounded-md p-0 text-sm font-bold text-foreground/60 hover:text-destructive"
      aria-label="Delete note"
      data-testid="post-it-card-delete"
      @pointerdown.stop
      @mousedown.prevent
      @dblclick.stop
      @click.stop="onDelete"
    >
      ✕
    </Button>

    <!-- Content is rendered as TEXT (interpolation only, never v-html);
         whitespace-pre-line preserves author newlines safely. -->
    <p class="break-words whitespace-pre-line text-sm text-foreground">
      {{ note.content }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@ugogalliano/pm-design-system-vue'

import { NOTE_COLORS } from '@/shared/constants/note-colors'
import type { NoteDto } from '@/shared/types/api'

// Presentational sticky note: it renders cache data and emits gestures —
// no stores, no mutations, no pointer math of its own. NoteCanvas wires
// this card to `useDragNote` and owns which card is being edited.
const props = withDefaults(
  defineProps<{
    note: NoteDto
    /** An editor is open over this card: hide the delete affordance. */
    editing?: boolean
    /** This card is the one being dragged (draggingId gate from the canvas). */
    dragging?: boolean
    /** Live drag delta (px). Applied as transform whenever NON-ZERO: the
     *  canvas only feeds a non-zero offset to the dragged card (live delta)
     *  or the just-dropped card (retained pending visual until the cache
     *  catches up), so a zero offset always means "render from cache". */
    offsetX?: number
    offsetY?: number
    /** No current Owner/Editor role is available to authorize note writes. */
    readOnly?: boolean
  }>(),
  { editing: false, dragging: false, offsetX: 0, offsetY: 0, readOnly: false },
)

const emit = defineEmits<{
  (e: 'edit', noteId: string): void
  (e: 'delete', noteId: string): void
  /** Carries the note id (like edit/delete) so the canvas can bind a stable
   *  method ref instead of a per-card closure (review fix: drag broadcast). */
  (e: 'pointerdown-drag', payload: { noteId: string; event: PointerEvent }): void
}>()

const FALLBACK_HEX = '#fcf292'

function onEdit(): void {
  if (!props.readOnly) emit('edit', props.note.id)
}

function onDelete(): void {
  if (!props.readOnly) emit('delete', props.note.id)
}

function onPointerdownDrag(event: PointerEvent): void {
  if (!props.readOnly) emit('pointerdown-drag', { noteId: props.note.id, event })
}

// Color via inline :style from the shared palette map — never dynamic
// `bg-${color}` classes (Tailwind cannot see them). The fallback defends
// against legacy/unknown tokens sneaking in through the cache.
const cardStyle = computed(() => {
  const palette: Partial<Record<string, string>> = NOTE_COLORS
  const style: Record<string, string> = {
    left: `${props.note.positionX}px`,
    top: `${props.note.positionY}px`,
    backgroundColor: palette[props.note.color] ?? FALLBACK_HEX,
  }
  // The canvas feeds a non-zero offset ONLY to the dragged card (live delta)
  // or the just-dropped card (retained pending visual), so a non-zero offset
  // always means "float above the cached spot" (review fix 3: survives the
  // pointerup → optimistic-write window without a snap-back flicker).
  if (props.offsetX !== 0 || props.offsetY !== 0) {
    // transform (not left/top) keeps the drag on the compositor: no layout
    // thrash per move (AGENTS.md §8).
    style.transform = `translate3d(${props.offsetX}px, ${props.offsetY}px, 0)`
  }
  return style
})
</script>
