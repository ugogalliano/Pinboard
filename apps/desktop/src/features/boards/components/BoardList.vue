<template>
  <section class="flex flex-col gap-3" data-testid="board-list">
    <div v-if="variant === 'cards'" class="flex items-center justify-between gap-3">
      <h2 class="text-lg font-bold text-foreground">Your boards</h2>
      <Button data-testid="create-board" @click="createOpen = true">Create Board</Button>
    </div>

    <!-- Initial load only: `isPending && isFetching` (a disabled query keeps
         isPending true, and a background refetch must not hide a list that
         is already on screen). -->
    <div
      v-if="isPending && isFetching"
      class="flex items-center justify-center py-10"
      data-testid="board-list-loading"
    >
      <Spinner label="Loading boards…" />
    </div>

    <div
      v-else-if="isError"
      class="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-card p-6 text-center"
      data-testid="board-list-error"
    >
      <p class="text-sm text-muted-foreground">We couldn't load your boards.</p>
      <Button variant="secondary" data-testid="board-list-retry" @click="retry">Try again</Button>
    </div>

    <p
      v-else-if="boards.length === 0"
      class="text-sm text-muted-foreground"
      data-testid="board-list-empty"
    >
      You don't have any boards yet. Create one to start collecting notes.
    </p>

    <ul v-else class="flex flex-col gap-2" data-testid="board-list-items">
      <li v-for="board in boards" :key="board.id">
        <BoardCard :board="board" :variant="variant === 'nav' ? 'nav' : 'card'" />
      </li>
    </ul>

    <!-- Only the cards variant has a trigger (see the header button above);
         mounting the dialog in the sidebar nav instance would build a form +
         a mutation for a dialog that can never open. -->
    <CreateBoardDialog v-if="variant === 'cards'" v-model:open="createOpen" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@ugogalliano/pm-design-system-vue'

import Spinner from '@/shared/components/ui/Spinner.vue'
import BoardCard from './BoardCard.vue'
import CreateBoardDialog from './CreateBoardDialog.vue'
import { useBoards } from '../composables/useBoards'

// `nav` = sidebar rail; `cards` = home grid.
type BoardListVariant = 'cards' | 'nav'

withDefaults(defineProps<{ variant?: BoardListVariant }>(), { variant: 'cards' })

const { data, isPending, isError, isFetching, refetch } = useBoards()
const boards = computed(() => data.value ?? [])

const createOpen = ref(false)

// The create dialog state is LOCAL, not uiStore.activeModal: that store field
// is a single string and two BoardList instances (home + sidebar) would
// contend for the same slot.
function retry(): void {
  void refetch()
}
</script>
