<template>
  <div class="flex h-full flex-col gap-6">
    <BoardHeader />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import BoardHeader from '../BoardHeader/BoardHeader.vue'

// Route shell for /boards/:boardId. Route SHAPE is future-proof (allowNotes):
// the canvas child route is swapped for NoteCanvas in Phase 5 and members
// join as a sibling in Phase 6 — neither touches this file.
</script>
