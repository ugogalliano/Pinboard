// Phase 5 (notes core): composables + canvas components.
export { default as NoteCanvas } from './components/NoteCanvas/NoteCanvas.vue'
export { default as PostItCard } from './components/PostItCard/PostItCard.vue'
export { default as PostItEditor } from './components/PostItEditor/PostItEditor.vue'
export { default as ColorPicker } from './components/ColorPicker/ColorPicker.vue'
export {
  notesKeys,
  useCreateNote,
  useDeleteNote,
  useNotesQuery,
  useUpdateNote,
  type CreateNoteValues,
  type DeleteNoteValues,
  type UpdateNoteValues,
} from './composables/useNotes'
export {
  clientToCanvas,
  useDragNote,
  type CanvasPoint,
  type DragPointer,
  type DragStartNote,
  type UseDragNoteOptions,
} from './composables/useDragNote'
