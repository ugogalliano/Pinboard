<template>
  <div
    class="absolute z-30 flex w-72 flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-lg"
    :data-testid="testIdPrefix"
    @dblclick.stop
    @keydown.esc="onEscape"
  >
    <!-- Form-level channel for a server 400 (note endpoints answer with
         `detail` only — never an `errors` dictionary — so the parent just
         hands down the mapped text; this component stays dumb). -->
    <p
      v-if="serverError"
      role="alert"
      data-testid="post-it-editor-form-error"
      class="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
    >
      {{ serverError }}
    </p>

    <textarea
      :id="`${testIdPrefix}-content-field`"
      ref="textareaRef"
      v-model="content"
      :data-testid="`${testIdPrefix}-content`"
      class="min-h-28 w-full resize-none rounded-md border border-border bg-background p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      :disabled="saving"
      placeholder="Write something…"
      @keydown.enter="onEnter"
      @blur="onBlur"
    ></textarea>

    <p
      v-if="contentError"
      :data-testid="`${testIdPrefix}-content-error`"
      class="text-xs font-medium text-destructive"
    >
      {{ contentError }}
    </p>

    <ColorPicker v-model="color" />

    <div class="flex items-center justify-end gap-2">
      <!-- `@mousedown.prevent`: clicking a button must not blur the textarea
           first — that would fire the save-on-blur path alongside the click.
           The ACTION stays on @click (mousedown is only prevented, never used
           as the action event). -->
      <Button
        variant="ghost"
        :disabled="saving"
        :data-testid="`${testIdPrefix}-cancel`"
        @mousedown.prevent
        @click="onCancel"
      >
        Cancel
      </Button>
      <Button
        :loading="saving"
        :disabled="saving"
        :data-testid="`${testIdPrefix}-save`"
        @mousedown.prevent
        @click="submit"
      >
        Save
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useField, useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { Button } from '@ugogalliano/pm-design-system-vue'

import { noteSchema } from '@/shared/validation/schemas'
import type { NoteColor } from '@/shared/constants/note-colors'
import ColorPicker from '../ColorPicker/ColorPicker.vue'

// Inline editor for one note (create draft or existing card). Validation is
// the shared `noteSchema` (content trim min 1 / max 1000, palette color):
// positions ride along as fixed form values so the FULL schema validates and
// the limits stay a single source of truth (AGENTS.md §4).
const props = withDefaults(
  defineProps<{
    initialContent: string
    initialColor: string
    positionX: number
    positionY: number
    /** In-flight save: disables both buttons (the parent owns the mutation). */
    saving?: boolean
    /** Server 400 detail mapped to text, rendered as a form-level alert. */
    serverError?: string | null
    /** Test-id namespace so canvas tests can tell draft and edit apart. */
    testIdPrefix?: string
  }>(),
  { saving: false, serverError: null, testIdPrefix: 'post-it-editor' },
)

const emit = defineEmits<{
  (e: 'save', value: { content: string; color: string }): void
  (e: 'cancel'): void
}>()

// `useForm` owns validation; the fields bind through `useField` so the native
// textarea (the design system ships no Textarea) and ColorPicker stay plain.
const { handleSubmit } = useForm({
  validationSchema: toTypedSchema(noteSchema),
  initialValues: {
    content: props.initialContent,
    // The cache carries `color` as a plain string; the schema validates
    // palette membership at submit time, and NoteCanvas normalizes legacy
    // tokens to a palette value before mounting the editor.
    color: props.initialColor as NoteColor,
    positionX: props.positionX,
    positionY: props.positionY,
  },
})

const { value: content, errorMessage: contentError } = useField<string>('content')
const { value: color } = useField<string>('color')

const textareaRef = ref<HTMLTextAreaElement | null>(null)

// Single-flight: Enter + blur can land on the same logical save, and a click
// on the Save button races the blur it causes. `submitted` blocks re-entry
// from the first successful emit until the parent's save cycle completes
// (`saving` true → false); a failed save therefore stays retryable.
let submitted = false
let cancelled = false

watch(
  () => props.saving,
  (saving) => {
    if (!saving) submitted = false
  },
)

const runSubmit = handleSubmit((values) => {
  if (submitted || cancelled) return
  submitted = true
  // Only content + color cross the emit boundary — positions belong to the
  // canvas (the draft point / the card's cached spot), never to the editor.
  emit('save', { content: values.content, color: values.color })
})

function submit(): void {
  if (submitted || cancelled || props.saving) return
  void runSubmit()
}

function onEnter(event: KeyboardEvent): void {
  // Shift+Enter keeps the browser default (insert newline); plain Enter saves.
  if (event.shiftKey) return
  event.preventDefault()
  submit()
}

function onBlur(): void {
  submit()
}

function onEscape(): void {
  // Escape discards with ZERO submits, even if the browser fires a trailing
  // blur when the editor unmounts — `cancelled` shuts the save paths down.
  cancelled = true
  emit('cancel')
}

function onCancel(): void {
  onEscape()
}

// Focus when opened (mounted fresh for each draft/edit — the canvas keys the
// instance), so Enter and blur behave like real editor interactions.
watch(
  textareaRef,
  (el) => {
    el?.focus()
  },
  { flush: 'post' },
)
</script>
