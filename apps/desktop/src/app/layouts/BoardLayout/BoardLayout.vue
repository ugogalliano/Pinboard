<template>
  <!-- Layout = chrome only (AuthLayout precedent): sidebar + header + the
       routed content area. No server calls, no state of its own. -->
  <div class="flex h-screen w-full overflow-hidden bg-background">
    <Sidebar>
      <BoardList variant="nav" />
    </Sidebar>

    <div class="flex min-w-0 flex-1 flex-col">
      <Header />
      <main class="flex-1 overflow-auto p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'

import Header from '@/shared/components/layout/Header/Header.vue'
import Sidebar from '@/shared/components/layout/Sidebar/Sidebar.vue'
import { BoardList } from '@/features/boards'
</script>
