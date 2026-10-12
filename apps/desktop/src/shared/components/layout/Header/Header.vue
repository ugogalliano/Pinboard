<template>
  <header
    class="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4"
    data-testid="app-header"
  >
    <h1 class="text-lg font-bold text-foreground">PostIt</h1>

    <div class="flex items-center gap-3">
      <span v-if="user" class="text-sm text-muted-foreground" data-testid="header-user">
        {{ user.displayName }}
      </span>
      <Button variant="secondary" size="sm" data-testid="logout" @click="onLogout">Log out</Button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { Button } from '@ugogalliano/pm-design-system-vue'

import { useAuthStore } from '@/stores/authStore'

// App chrome only (AuthLayout precedent): brand, who is signed in, and the
// session exit. Navigation itself is the router's job (guards live in
// app/router.ts), so logging out only clears the session and lets the guard
// bounce the guest away.
const auth = useAuthStore()
const { user } = storeToRefs(auth)
const router = useRouter()

async function onLogout(): Promise<void> {
  await auth.logout()
  await router.push('/login')
}
</script>
