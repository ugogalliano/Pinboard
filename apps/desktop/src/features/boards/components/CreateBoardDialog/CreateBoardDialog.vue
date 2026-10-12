<template>
  <Dialog
    :open="open"
    title="Create board"
    description="Name your board — you can rename or delete it later."
    @update:open="emit('update:open', $event)"
  >
    <form class="flex flex-col gap-4" novalidate @submit="onSubmit">
      <p
        v-if="formError"
        role="alert"
        class="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
      >
        {{ formError }}
      </p>
      <Input
        id="create-board-name"
        name="name"
        label="Board name"
        placeholder="e.g. Product launch"
        required
      />
    </form>

    <template #footer>
      <!-- Plain buttons (not a form submit): the Dialog renders the footer
           outside the form element, and Enter inside the field still
           submits through the form's own handler. -->
      <Button variant="secondary" :disabled="isSubmitting" @click="close">Cancel</Button>
      <Button
        data-testid="create-board-submit"
        type="button"
        :loading="isSubmitting"
        :disabled="isSubmitting"
        @click="onSubmit"
      >
        Create
      </Button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { Button, Dialog, Input } from '@ugogalliano/pm-design-system-vue'

import { boardNameSchema } from '@/shared/validation/schemas'
import { isApiError, mapApiErrorToMessage } from '@/shared/services/api'
import { useCreateBoard } from '../../composables/useBoards'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const { handleSubmit, isSubmitting, resetForm } = useForm({
  validationSchema: toTypedSchema(boardNameSchema),
})

// Form-level channel for a server 400 (board endpoints answer with `detail`
// only — never an `errors` dictionary — so there is no setErrors branch).
const formError = ref<string | null>(null)

const { mutateAsync } = useCreateBoard()

function close(): void {
  emit('update:open', false)
}

// Every opening starts from a clean form (a previous attempt's text or
// error must not leak into the next one).
watch(
  () => props.open,
  (open) => {
    if (open) {
      formError.value = null
      resetForm()
    }
  },
  { immediate: true },
)

const onSubmit = handleSubmit(async (values) => {
  formError.value = null
  try {
    await mutateAsync({ name: values.name })
    close()
  } catch (err) {
    if (isApiError(err) && err.status === 400) {
      formError.value = mapApiErrorToMessage(err)
      return
    }
    // Anything else already produced an error toast in useCreateBoard's
    // onError — toasting again here would double it.
  }
})
</script>
