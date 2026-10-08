<script setup lang="ts">
import { useRouter } from 'vue-router'

import { Button } from '@ugogalliano/pm-design-system-vue'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const authStore = useAuthStore()

async function onLogout(): Promise<void> {
  await authStore.logout()
  await router.push('/login')
}
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-2">
    <h1 class="text-2xl font-bold">PostIt</h1>
    <p class="text-sm text-gray-500">Desktop client skeleton — Phase 1</p>
    <Button variant="secondary" @click="onLogout">Logout</Button>
  </main>
</template>
