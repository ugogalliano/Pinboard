<template>
  <!-- Board names are user content: text interpolation only, never v-html. -->
  <RouterLink
    :to="{ name: 'board-canvas', params: { boardId: board.id } }"
    :aria-current="isActive ? 'page' : undefined"
    :class="[cardClass, isActive && activeClass]"
    data-testid="board-card"
  >
    <span class="flex items-center justify-between gap-2">
      <span class="truncate font-semibold text-foreground">{{ board.name }}</span>
      <span v-if="isActive" class="text-xs font-medium text-primary">Current</span>
    </span>
    <span class="mt-0.5 block text-xs text-muted-foreground">{{ createdLabel }}</span>
    <span class="mt-0.5 block text-xs text-muted-foreground">
      {{ board.memberCount }} {{ board.memberCount === 1 ? 'member' : 'members' }}
    </span>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import type { BoardDto } from '@/shared/types/api'

// `nav` = compact row inside the sidebar; `card` = home grid tile.
type BoardCardVariant = 'card' | 'nav'

const props = withDefaults(defineProps<{ board: BoardDto; variant?: BoardCardVariant }>(), {
  variant: 'card',
})

const route = useRoute()

// activeBoard derives from the route param — never from a store (AGENTS.md §5).
const isActive = computed(() => route.params.boardId === props.board.id)

const createdLabel = computed(() => {
  const date = new Date(props.board.createdAt)
  return `Created ${date.toLocaleDateString()}`
})

const cardClass = computed(() =>
  props.variant === 'nav'
    ? 'group block rounded-lg border border-transparent px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    : 'group block rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
)

const activeClass = computed(() =>
  props.variant === 'nav' ? 'bg-accent border-border' : 'border-primary/50 bg-accent/40',
)
</script>
