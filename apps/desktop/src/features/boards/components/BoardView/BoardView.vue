<template>
  <div class="flex h-full flex-col gap-6">
    <!-- Indicator aligned right in the header row so it shows on BOTH child
         routes (canvas and /members): the board shell lives above the outlet,
         and app chrome (BoardLayout/Header) never learns about connection
         state (PLAN §10). -->
    <div class="flex items-start gap-4">
      <div class="min-w-0 flex-1">
        <BoardHeader />
      </div>
      <div class="flex h-14 shrink-0 items-center justify-end">
        <ConnectionStatus />
      </div>
    </div>
    <RouterView :key="boardId" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { normalizeRouteId } from '@/shared/composables/normalizeRouteId'
import ConnectionStatus from '@/shared/components/ui/ConnectionStatus/ConnectionStatus.vue'
import BoardHeader from '../BoardHeader/BoardHeader.vue'

// Route shell for /boards/:boardId. Route SHAPE is future-proof (allowNotes):
// the canvas child route is swapped for NoteCanvas in Phase 5 and members
// join as a sibling in Phase 6 — neither touches this file.

// CRITICAL-1 (Phase 7 perf review): Vue Router REUSES the outlet component
// when only the :boardId param changes, so the canvas mount-time hub
// subscription (useNotesRealtime) would pin to the first board forever.
// Keying the outlet on the NORMALIZED boardId forces a remount on a real
// board switch (A→B: canvas unmounts → leaveBoard(A), mounts → joinBoard(B)).
// The key is board-scoped, NOT path-scoped: same-board navigations (query
// changes; the canvas↔members swap replaces the component on its own) never
// remount through this key.
const route = useRoute()
const boardId = computed(() => normalizeRouteId(route.params.boardId) ?? '')
</script>
