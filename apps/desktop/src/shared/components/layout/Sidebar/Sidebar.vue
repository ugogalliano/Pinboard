<template>
  <aside
    class="flex h-full shrink-0 flex-col gap-3 border-r border-border bg-sidebar p-3 transition-[width]"
    :class="sidebarOpen ? 'w-64' : 'w-16'"
    data-testid="sidebar"
    :data-open="sidebarOpen ? 'true' : 'false'"
  >
    <Button
      variant="ghost"
      size="sm"
      data-testid="sidebar-toggle"
      :aria-expanded="sidebarOpen ? 'true' : 'false'"
      aria-controls="sidebar-nav"
      @click="ui.toggleSidebar()"
    >
      {{ sidebarOpen ? 'Collapse' : 'Expand' }}
    </Button>

    <!-- v-if (not v-show): a collapsed sidebar is a narrow rail, so the nav
         leaves the DOM — remounting is free (staleTime keeps it cached). -->
    <div v-if="sidebarOpen" id="sidebar-nav" class="flex flex-1 flex-col gap-3 overflow-y-auto">
      <p class="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Boards</p>
      <slot />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Button } from '@ugogalliano/pm-design-system-vue'

import { useUIStore } from '@/stores/uiStore'

// App chrome only: shared/ must never import features, so the nav content
// arrives through the default slot (BoardLayout passes <BoardList
// variant="nav" />). Collapsed, the sidebar keeps a narrow rail with the
// toggle still reachable.
const ui = useUIStore()
const { sidebarOpen } = storeToRefs(ui)
</script>
