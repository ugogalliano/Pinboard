<template>
  <Dialog
    :open="open"
    title="Add a board member"
    description="Invite someone to collaborate on this board."
    :dismissable="!isSubmitting"
    @update:open="emit('update:open', $event)"
  >
    <form class="flex flex-col gap-4" novalidate @submit="onSubmit">
      <p
        v-if="formError"
        role="alert"
        data-testid="add-member-error"
        class="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
      >
        {{ formError }}
      </p>
      <Input
        id="add-member-email"
        name="email"
        type="email"
        label="Email address"
        placeholder="you@example.com"
        required
      />
      <label for="add-member-role" class="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Role
        <select
          id="add-member-role"
          name="role"
          :value="roleField.value.value"
          :disabled="isSubmitting"
          class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          @change="roleField.handleChange"
        >
          <option value="Editor">Editor</option>
          <option value="Viewer">Viewer</option>
        </select>
      </label>
      <p
        v-if="roleField.errorMessage.value"
        id="add-member-role-error"
        data-testid="add-member-role-error"
        class="text-sm text-destructive"
      >
        {{ roleField.errorMessage.value }}
      </p>
    </form>

    <template #footer>
      <Button
        variant="secondary"
        data-testid="cancel-add-member"
        :disabled="isSubmitting"
        @click="close"
        >Cancel</Button
      >
      <Button
        data-testid="add-member-submit"
        type="button"
        :loading="isSubmitting"
        :disabled="isSubmitting"
        @click="onSubmit"
      >
        Add member
      </Button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useField, useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { Button, Dialog, Input } from '@ugogalliano/pm-design-system-vue'

import { memberSchema } from '@/shared/validation/schemas'
import { isApiError, mapApiErrorToMessage } from '@/shared/services/api'
import type { AssignableRole } from '@/shared/types/api'
import { useAddMember } from '../../composables/useMembers'

const props = defineProps<{ boardId: string; open: boolean }>()
const emit = defineEmits<{ (event: 'update:open', value: boolean): void }>()

const { handleSubmit, isSubmitting, resetForm } = useForm({
  validationSchema: toTypedSchema(memberSchema),
  initialValues: { role: 'Editor' as AssignableRole },
})
const roleField = useField<AssignableRole>('role')
const formError = ref<string | null>(null)
const { mutateAsync } = useAddMember(computed(() => props.boardId))

function close(): void {
  emit('update:open', false)
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      formError.value = null
      resetForm({ values: { role: 'Editor' } })
    }
  },
  { immediate: true },
)

const onSubmit = handleSubmit(async (values) => {
  formError.value = null
  try {
    await mutateAsync(values)
    close()
  } catch (error) {
    if (isApiError(error) && error.status === 409) {
      formError.value = `${mapApiErrorToMessage(error)}. Check whether this email is already a board member, then try again.`
    } else if (isApiError(error) && error.status === 400) {
      formError.value = mapApiErrorToMessage(error)
    }
    // Mutation errors are already safely mapped to a toast by useAddMember.
  }
})
</script>
