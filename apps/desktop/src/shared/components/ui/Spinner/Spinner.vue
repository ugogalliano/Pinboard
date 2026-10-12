<template>
  <!-- role="status" (implicit aria-live="polite") so the loading state is
       announced; the spinner itself stays aria-hidden decoration. -->
  <div role="status" class="inline-flex items-center justify-center" data-slot="spinner">
    <div
      class="animate-spin rounded-full border-2 border-muted border-t-primary"
      :class="sizeClass"
      aria-hidden="true"
    />
    <span class="sr-only">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
// Loading indicator. The design system ships no spinner, so PLAN.FE.md (Phase 8
// loading states) reserves this shared component: Tailwind's `animate-spin`
// over a muted ring with a primary arc — no new dependency, no arbitrary SVG.
interface Props {
  /** Accessible label announced by screen readers. */
  label?: string
  /** Tailwind size utilities for the indicator box (e.g. `h-5 w-5`). */
  sizeClass?: string
}

withDefaults(defineProps<Props>(), {
  label: 'Loading…',
  sizeClass: 'h-6 w-6',
})
</script>
