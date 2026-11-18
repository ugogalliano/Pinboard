<template>
  <Dialog
    :open="open && isOwner"
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
        :disabled="isSubmitting || !isOwner"
      />
      <label for="add-member-role" class="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Role
        <select
          id="add-member-role"
          name="role"
          :value="roleField.value.value"
          :disabled="isSubmitting || !isOwner"
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
        :disabled="isSubmitting || !isOwner"
        @click="close"
        >Cancel</Button
      >
      <Button
        data-testid="add-member-submit"
        type="button"
        :loading="isSubmitting"
        :disabled="isSubmitting || !isOwner"
        @click="onSubmit"
      >
        Add member
      </Button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useField, useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { Button, Dialog, Input, useToast } from '@ugogalliano/pm-design-system-vue'

import { memberSchema } from '@/shared/validation/schemas'
import { isApiError, mapApiErrorToMessage, mapProblemErrors } from '@/shared/services/api'
import type { AssignableRole } from '@/shared/types/api'
import { useAddMember, useCurrentBoardRole } from '../../composables/useMembers'

const props = defineProps<{ boardId: string; open: boolean }>()
const emit = defineEmits<{ (event: 'update:open', value: boolean): void }>()
const { toast } = useToast()

const { handleSubmit, isSubmitting, resetForm, setErrors } = useForm({
  validationSchema: toTypedSchema(memberSchema),
  initialValues: { role: 'Editor' as AssignableRole },
})
const roleField = useField<AssignableRole>('role')
const formError = ref<string | null>(null)
const { mutateAsync } = useAddMember(computed(() => props.boardId))
const currentRole = useCurrentBoardRole(computed(() => props.boardId))
const isOwner = computed(() => currentRole.value === 'Owner')

function close(): void {
  emit('update:open', false)
}

// Close only on a SETTLED non-Owner role. A transient `null` from
// useCurrentBoardRole (pending/refetching/failing reads are fail-closed by
// design) must NOT close the dialog: the mutation's own `onSettled`
// invalidation refetches the members list after EVERY add attempt, so
// treating that blip as "no longer Owner" would dismiss the dialog exactly
// when the user needs to fix a field error and retry. Render-level gating
// (`:open="open && isOwner"`, disabled controls) still fails closed.
watch(
  currentRole,
  (role) => {
    if (role !== null && role !== 'Owner' && props.open) close()
  },
  { flush: 'sync' },
)

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

// Deferred field writes: when the DS footer Button flips its `loading`/
// `disabled` as isSubmitting settles, the reka-ui content re-render remounts
// the INPUT and its vee-validate PathState is dropped — a field error set
// synchronously inside the callback is therefore wiped a beat later
// (verified: the Dialog `dismissable` and Input `disabled` flips are
// innocent; the footer-button flip is the culprit). The synchronous write
// shows the error immediately; the setTimeout(0) re-write lands AFTER that
// flush so it PERSISTS (0 ms = the next macrotask, after Vue's microtask
// re-render — the refetch round-trip takes far longer, see the tests).
// Follow-up candidate: lift this double-write into a shared helper once a
// second dialog needs it (deliberately NOT extracted now: minimal diff).
let fieldErrorTimer: ReturnType<typeof setTimeout> | null = null

function applyFieldErrors(fields: Record<string, string>): void {
  setErrors(fields)
  if (fieldErrorTimer !== null) clearTimeout(fieldErrorTimer)
  fieldErrorTimer = setTimeout(() => {
    fieldErrorTimer = null
    setErrors(fields)
  }, 0)
}

// A pending rewrite into an unmounted form is pointless (and a stray timer
// keeps the callback alive past teardown): cancel it with the scope.
onScopeDispose(() => {
  if (fieldErrorTimer !== null) clearTimeout(fieldErrorTimer)
  fieldErrorTimer = null
})

const onSubmit = handleSubmit(async (values) => {
  if (!isOwner.value) {
    close()
    return
  }
  formError.value = null
  try {
    await mutateAsync(values)
    // Success toast (§13 "Success toasts"): the dialog closes and the new
    // row lands in a list that may not be in view.
    toast({ variant: 'success', message: 'Member added' })
    close()
  } catch (error) {
    // Precedence mirrors useAuth.handleAuthError: an `errors` dict maps to
    // field errors FIRST; only a dict-less 400 falls back to `detail`.
    if (isApiError(error) && error.status === 400) {
      const fields = mapProblemErrors(error.problem)
      if (Object.keys(fields).length > 0) {
        applyFieldErrors(fields)
      } else {
        formError.value = mapApiErrorToMessage(error)
      }
    } else if (isApiError(error) && error.status === 404) {
      // Unknown email: no account to invite — the actionable field is email.
      applyFieldErrors({ email: 'No account with this email exists' })
    } else if (isApiError(error) && error.status === 409) {
      formError.value = `${mapApiErrorToMessage(error)}. Check whether this email is already a board member, then try again.`
    }
    // Mutation errors are already safely mapped to a toast by useAddMember.
  }
})
</script>
