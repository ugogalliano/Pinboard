<template>
  <!-- Connection affordance for the board hub (PLAN.FE.md Phase 7). role="status"
       carries an implicit aria-live="polite" so state changes are announced;
       the dot itself is decorative. Renders NOTHING while Connected, and while
       Disconnected/Connecting UNTIL this session has connected at least once
       (see seenConnected below) — the affordance is about CONNECTION LOSS, so
       the canvas' first paint (state 'Disconnected' before onMounted connects)
       must not flash it. -->
  <div
    v-if="visible"
    role="status"
    class="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground"
    data-testid="connection-status"
    :data-state="state"
  >
    <span
      :class="['h-2 w-2 shrink-0 rounded-full', dotClass]"
      aria-hidden="true"
      data-testid="connection-status-dot"
    />
    <span>{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useBoardConnectionState } from '@/shared/composables/useSignalR'

// Isolated subscription (AGENTS §8): ONLY this component re-renders on
// connection-state changes — it reads the transport's module-level ref through
// the shared accessor, with no provide/inject through the canvas and no Pinia
// mirror (the service stays the single source of truth).

const state = useBoardConnectionState()

// Session gate: the canvas only connects after mount, so a raw 'Disconnected'
// at first paint is not a loss — it is "not started yet". We therefore show
// the Disconnected/Connecting variants only once this session has been
// connected ('Reconnecting' implies it by definition and needs no gate).
const seenConnected = ref(false)

watch(
  state,
  (value) => {
    // 'Reconnecting' can only FOLLOW a successful connect, so it also counts
    // as "has connected" (covers a remount while the shared connection churns).
    if (value === 'Connected' || value === 'Reconnecting') {
      seenConnected.value = true
    }
  },
  // immediate: a remount onto a live 'Connected' connection records the fact
  // even though no transition is observed by this instance.
  { immediate: true },
)

const visible = computed(() => {
  if (state.value === 'Connected') return false
  if (state.value === 'Reconnecting') return true
  return seenConnected.value
})

const dotClass = computed(() => {
  switch (state.value) {
    case 'Reconnecting':
      // No amber token in the design system, so the Tailwind palette stands in
      // (red uses the app's existing `destructive` token).
      return 'bg-amber-500'
    case 'Disconnected':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground'
  }
})

const label = computed(() => {
  switch (state.value) {
    case 'Reconnecting':
      return 'Reconnecting…'
    case 'Disconnected':
      return 'Disconnected'
    default:
      return 'Connecting…'
  }
})
</script>
