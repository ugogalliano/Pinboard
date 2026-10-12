<template>
  <section
    class="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-canvas p-10 text-center"
    data-testid="board-canvas-placeholder"
  >
    <p class="text-base font-semibold text-foreground">Notes canvas arrives in the next phase</p>
    <p class="text-sm text-muted-foreground">
      Double-click to create a note, drag to move it, and see your teammates' changes in real time.
    </p>
  </section>
</template>

<script setup lang="ts">
// Placeholder for the board canvas. Swapped for NoteCanvas in Phase 5
// (POSTItCard, double-click-to-create, drag & drop) — nothing else renders
// inside the board route today, so the empty state owns the whole surface.
</script>
