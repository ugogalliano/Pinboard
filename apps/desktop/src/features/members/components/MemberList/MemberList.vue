<template>
  <section class="flex flex-col gap-4" data-testid="member-list">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-bold text-foreground">Board members</h2>
        <p class="text-sm text-muted-foreground">People who can access this board.</p>
      </div>
      <Button
        v-if="isOwner"
        data-testid="add-member"
        @click="addOpen = true"
        >Add member</Button
      >
    </div>

    <div
      v-if="isPending && isFetching"
      class="flex items-center justify-center py-8"
      data-testid="members-loading"
    >
      <Spinner label="Loading members…" />
    </div>

    <div
      v-else-if="isError"
      class="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-card p-6 text-center"
      data-testid="members-error"
    >
      <p class="text-sm text-muted-foreground">We couldn't load this board's members.</p>
      <Button variant="secondary" data-testid="members-retry" @click="retry">Try again</Button>
    </div>

    <p v-else-if="members.length === 0" class="text-sm text-muted-foreground" data-testid="members-empty">
      No members yet.
    </p>

    <ul v-else class="flex flex-col gap-2" data-testid="members-items">
      <li
        v-for="member in members"
        :key="member.userId"
        :data-testid="`member-${member.userId}`"
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
      >
        <div class="min-w-0">
          <p class="truncate font-medium text-foreground">{{ member.displayName }}</p>
          <p class="truncate text-sm text-muted-foreground">{{ member.email }}</p>
        </div>
        <div class="flex items-center gap-2">
          <RoleSelect
            v-if="isOwner && member.role !== 'Owner'"
            :data-testid="`role-select-${member.userId}`"
            :role="member.role"
            :disabled="isUpdating"
            @update:role="changeRole(member.userId, $event)"
          />
          <span
            v-else
            class="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground"
            :data-testid="`member-role-${member.userId}`"
          >
            {{ member.role }}
          </span>
          <Button
            v-if="isOwner && member.role !== 'Owner'"
            variant="destructive"
            :data-testid="`remove-member-${member.userId}`"
            @click="selectedForRemoval = member"
          >
            Remove
          </Button>
        </div>
      </li>
    </ul>

    <AddMemberDialog v-model:open="addOpen" :board-id="boardId" />

    <Dialog
      :open="Boolean(selectedForRemoval)"
      :title="`Remove ${selectedForRemoval?.displayName ?? 'member'} from this board?`"
      description="They will no longer be able to access this board."
      :dismissable="!isRemoving"
      @update:open="onRemoveDialogOpen"
    >
      <p class="text-sm text-muted-foreground">
        Are you sure you want to remove
        <span class="font-semibold text-foreground">{{ selectedForRemoval?.displayName }}</span>?
      </p>
      <template #footer>
        <Button
          variant="secondary"
          data-testid="cancel-remove-member"
          :disabled="isRemoving"
          @click="selectedForRemoval = null"
          >Cancel</Button
        >
        <Button
          variant="destructive"
          data-testid="confirm-remove-member"
          :loading="isRemoving"
          :disabled="isRemoving"
          @click="confirmRemove"
          >Remove member</Button
        >
      </template>
    </Dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, Dialog } from '@ugogalliano/pm-design-system-vue'

import Spinner from '@/shared/components/ui/Spinner/Spinner.vue'
import type { BoardMemberDto, AssignableRole } from '@/shared/types/api'
import {
  useCurrentBoardRole,
  useMembersQuery,
  useRemoveMember,
  useUpdateMember,
} from '../../composables/useMembers'
import AddMemberDialog from '../AddMemberDialog/AddMemberDialog.vue'
import RoleSelect from '../RoleSelect/RoleSelect.vue'

const props = defineProps<{ boardId: string }>()

const boardId = computed(() => props.boardId)
const { data, isPending, isError, isFetching, refetch } = useMembersQuery(boardId)
const currentRole = useCurrentBoardRole(boardId)
const members = computed(() => data.value ?? [])
const isOwner = computed(() => currentRole.value === 'Owner')
const addOpen = ref(false)
const selectedForRemoval = ref<BoardMemberDto | null>(null)
const { mutateAsync: updateMember, isPending: isUpdating } = useUpdateMember(boardId)
const { mutateAsync: removeMember, isPending: isRemoving } = useRemoveMember(boardId)

function retry(): void {
  void refetch()
}

async function changeRole(userId: string, role: AssignableRole): Promise<void> {
  try {
    await updateMember({ userId, role })
  } catch {
    // Rollback and the single safe error toast live in the mutation composable.
  }
}

function onRemoveDialogOpen(open: boolean): void {
  if (!open && !isRemoving.value) selectedForRemoval.value = null
}

async function confirmRemove(): Promise<void> {
  const member = selectedForRemoval.value
  if (!member) return
  try {
    await removeMember(member.userId)
    selectedForRemoval.value = null
  } catch {
    // Rollback and the single safe error toast live in the mutation composable.
  }
}
</script>
