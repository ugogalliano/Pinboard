import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { LoginResponse, MeResponse } from '@/shared/types/api'
import {
  clearTokens,
  getAccessToken,
  setAccessToken,
  setRefreshToken,
} from '@/shared/services/token'

// Client state for auth only. NO network actions here: login/register/logout/
// refreshUser arrive in Phase 3 via the auth feature. Tokens themselves live
// in token.ts (single owner); this store never mirrors them.
export const useAuthStore = defineStore('auth', () => {
  const user = ref<MeResponse | null>(null)
  const isLoading = ref(false)

  const isAuthenticated = computed(() => !!getAccessToken() && user.value !== null)

  /** Delegates persistence to token.ts (access → memory, refresh → localStorage). */
  function setTokens(payload: LoginResponse): void {
    setAccessToken(payload.accessToken)
    setRefreshToken(payload.refreshToken)
  }

  function setUser(value: MeResponse | null): void {
    user.value = value
  }

  function clearAuth(): void {
    clearTokens()
    user.value = null
  }

  function setLoading(value: boolean): void {
    isLoading.value = value
  }

  return { user, isLoading, isAuthenticated, setTokens, setUser, clearAuth, setLoading }
})
