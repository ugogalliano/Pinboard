<template>
  <div
    class="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-card p-6 text-center"
    data-testid="error-fallback"
  >
    <h2 class="text-lg font-bold text-foreground" data-testid="error-fallback-title">
      {{ title }}
    </h2>
    <p class="text-sm text-muted-foreground" role="alert">{{ message }}</p>
    <Button variant="secondary" data-testid="error-fallback-retry" @click="emit('retry')">
      Try again
    </Button>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@ugogalliano/pm-design-system-vue'

// Global error boundary UI (PLAN.FE.md §13 layer 4). Renders ONLY the mapped,
// safe message handed down by useGlobalError — never raw error text or stack,
// and never via v-html (AGENTS.md §7). App.vue swaps the routed content for
// this fallback; the retry button re-mounts the content.
withDefaults(defineProps<{ title?: string; message: string }>(), {
  title: 'Something went wrong',
})

const emit = defineEmits<{ (event: 'retry'): void }>()
</script>
