<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useRoute, useRouter } from 'vue-router'
import { Button, Dialog, Input, useToast } from '@ugogalliano/pm-design-system-vue'

import { boardNameSchema } from '@/shared/validation/schemas'
import { isApiError, mapApiErrorToMessage } from '@/shared/services/api'
import Spinner from '@/shared/components/ui/Spinner.vue'
import { canManageBoard, useDeleteBoard, useUpdateBoard } from '../composables/useBoards'
import { useBoard } from '../composables/useBoard'

const route = useRoute()
const router = useRouter()
const { toast } = useToast()

// The `:boardId` route param is normalized once, inside the composable.
const {
  data: board,
  isPending,
  isError,
  isFetching,
  refetch,
} = useBoard(computed(() => route.params.boardId))

const canManage = computed(() => (board.value ? canManageBoard(board.value) : false))

// ── Rename (Owner only) ─────────────────────────────────────────────────
const {
  handleSubmit,
  isSubmitting: isRenaming,
  setFieldValue,
  resetForm,
} = useForm({
  validationSchema: toTypedSchema(boardNameSchema),
})

const renaming = ref(false)

// Form-level channel for a server 400 (board endpoints answer with `detail`
// only — never an `errors` dictionary — so there is no setErrors branch).
const renameError = ref<string | null>(null)

// Seed the inline field from the loaded board (skip validation: we are
// populating, not re-validating).
watch(
  board,
  (value) => {
    if (value) setFieldValue('name', value.name, false)
  },
  { immediate: true },
)

// Every (re)opening starts from the board's SAVED name: text abandoned by a
// Cancel — or by a failed save — must not leak into the next attempt.
watch(renaming, (open) => {
  if (!open) return
  renameError.value = null
  resetForm({ values: { name: board.value?.name ?? '' } })
})

const { mutateAsync: updateBoard } = useUpdateBoard()

// Bound once here so the template can hand the handler to @click / @submit.
// handleSubmit re-throws whatever the callback throws, so a failed PUT has to
// be caught HERE: an escaping rejection is an unhandledrejection that
// app.config.errorHandler never sees.
const submitRename = handleSubmit(async (values) => {
  if (!board.value) return
  renameError.value = null
  try {
    await updateBoard({ id: board.value.id, name: values.name })
    renaming.value = false
  } catch (err) {
    if (isApiError(err) && err.status === 400) {
      renameError.value = mapApiErrorToMessage(err)
      return
    }
    // Anything else already produced an error toast in useUpdateBoard's
    // onError — toasting again here would double it.
  }
})

function retry(): void {
  void refetch()
}

// ── Delete (Owner only) ─────────────────────────────────────────────────
const deleteOpen = ref(false)
const { mutateAsync: deleteBoard, isPending: isDeleting } = useDeleteBoard()

async function confirmDelete(): Promise<void> {
  if (!board.value) return
  try {
    await deleteBoard(board.value.id)
    toast({ variant: 'success', message: 'Board deleted' })
    await router.push('/')
  } catch {
    // Rollback + toast live in the composable; the user stays on the board.
  }
}
</script>

<template>
  <header class="flex flex-col gap-3 border-b border-border pb-4" data-testid="board-header">
    <!-- Initial load only, and never over a board we can still show:
         keepPreviousData holds the previous board in `data` while a new one
         loads (isPending stays true), so revalidating must not hide it. -->
    <div v-if="isPending && isFetching && !board" class="flex items-center justify-center py-6">
      <Spinner label="Loading board…" />
    </div>

    <div
      v-else-if="isError"
      class="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-card p-6 text-center"
      data-testid="board-header-error"
    >
      <p class="text-sm text-muted-foreground">We couldn't open this board.</p>
      <Button variant="secondary" @click="retry">Try again</Button>
    </div>

    <template v-else-if="board">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <template v-if="renaming">
            <p
              v-if="renameError"
              role="alert"
              class="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
            >
              {{ renameError }}
            </p>
            <form class="flex items-end gap-2" novalidate @submit.prevent="submitRename">
              <Input
                id="rename-board-name"
                name="name"
                label="Board name"
                :disabled="isRenaming"
                required
              />
              <Button
                type="button"
                :loading="isRenaming"
                :disabled="isRenaming"
                data-testid="rename-board-save"
                @click="submitRename"
              >
                Save
              </Button>
              <Button
                variant="ghost"
                :disabled="isRenaming"
                data-testid="rename-board-cancel"
                @click="renaming = false"
                >Cancel</Button
              >
            </form>
          </template>
          <template v-else>
            <h2 class="text-2xl font-bold text-foreground" data-testid="board-name">
              {{ board.name }}
            </h2>
            <p class="text-sm text-muted-foreground">
              Created {{ new Date(board.createdAt).toLocaleDateString() }}
            </p>
          </template>
        </div>

        <!-- Owner-only actions: the API rejects rename/delete for everyone
             else (403), so they are hidden rather than disabled. -->
        <div v-if="canManage && !renaming" class="flex items-center gap-2">
          <Button variant="secondary" data-testid="rename-board" @click="renaming = true"
            >Rename</Button
          >
          <Button variant="destructive" data-testid="delete-board" @click="deleteOpen = true">
            Delete
          </Button>
        </div>
      </div>

      <Dialog
        :open="deleteOpen"
        title="Delete this board?"
        description="Deleting a board is permanent: every note it contains is removed too."
        :dismissable="!isDeleting"
        @update:open="deleteOpen = $event"
      >
        <p class="text-sm text-muted-foreground">
          "<span class="font-semibold text-foreground">{{ board.name }}</span
          >" will be permanently deleted, together with every note it contains. This cannot be
          undone.
        </p>
        <template #footer>
          <Button
            variant="secondary"
            data-testid="cancel-delete-board"
            :disabled="isDeleting"
            @click="deleteOpen = false"
            >Cancel</Button
          >
          <Button
            variant="destructive"
            data-testid="confirm-delete-board"
            type="button"
            :loading="isDeleting"
            :disabled="isDeleting"
            @click="confirmDelete"
          >
            Delete board
          </Button>
        </template>
      </Dialog>
    </template>
  </header>
</template>
