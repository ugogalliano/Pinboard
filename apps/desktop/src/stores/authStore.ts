import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { LoginRequest, LoginResponse, MeResponse, RegisterRequest } from '@/shared/types/api'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from '@/shared/services/token'
import { apiClient, mapApiErrorStatus, ProfileLoadError } from '@/shared/services/api'
import { onSessionTerminated } from '@/shared/services/session'
import { queryClient } from '@/app/queryClient'
import { useToast } from '@ugogalliano/pm-design-system-vue'

// Client state for auth only. Auth network calls (login/register/refresh/
// logout) live here per AGENTS.md §5 — they manage tokens, not cacheable
// server state. Tokens themselves live in token.ts (single owner); this
// store never mirrors them. The queryClient singleton is the one accepted
// app/ import (logout must clear the server-state cache, PLAN.FE.md §7).
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

  // ── Terminal session loss (SEC fix, Phase 3 review) ────────────────────
  // api.ts cannot import this store, so a failed mid-session refresh pings
  // the session bus instead. The full logout (user, tokens, query cache,
  // toast) happens immediately, not lazily on next navigation. Store setup
  // runs exactly once per Pinia, so registration is naturally one-shot;
  // session.ts dedupes by handler identity and tests clear the bus.
  onSessionTerminated(() => {
    clearAuth()
    queryClient.clear()
    useToast().toast({ variant: 'error', message: mapApiErrorStatus(401) })
  })

  // ── Network actions (Phase 3) ──────────────────────────────────────────

  /** POST /api/auth/login → store tokens → load the profile. Throws on failure. */
  async function login(request: LoginRequest): Promise<void> {
    const response = await apiClient<LoginResponse>('POST', '/api/auth/login', request)
    if (!response?.accessToken || !response.refreshToken) {
      throw new Error('Login did not return a complete session.')
    }
    setTokens(response)
    try {
      await refreshUser()
    } catch (err) {
      // Half-session guard (REVIEW fix 1): tokens must never survive a
      // failed profile load. The marker class keeps the form from
      // mislabeling this as "Invalid email or password".
      clearAuth()
      throw new ProfileLoadError(err)
    }
  }

  /**
   * POST /api/auth/register (201 with body or 204/empty — both tolerated,
   * the backend contract is void-or-resource) then auto-login (PLAN.FE.md
   * Phase 3 acceptance: "user can register").
   */
  async function register(request: RegisterRequest): Promise<void> {
    await apiClient<void>('POST', '/api/auth/register', request)
    await login({ email: request.email, password: request.password })
  }

  /** GET /api/auth/me → user. */
  async function refreshUser(): Promise<void> {
    const me = await apiClient<MeResponse>('GET', '/api/auth/me')
    setUser(me ?? null)
  }

  /**
   * Best-effort POST /api/auth/logout, then wipe the local session + cache.
   * The backend contract (AuthController.Logout → RefreshRequest) requires
   * the refresh token in the body — read it BEFORE clearing, and skip the
   * call entirely when no refresh token exists (nothing to revoke).
   */
  async function logout(): Promise<void> {
    const refreshToken = getRefreshToken()
    try {
      if (refreshToken) {
        await apiClient<void>('POST', '/api/auth/logout', { refreshToken })
      }
    } catch {
      // Offline/failed logout must still clear the local session.
    }
    clearAuth()
    queryClient.clear()
  }

  /**
   * Session bootstrap, called once by the router guard on first navigation
   * (PLAN.FE.md §7 "App start"): exchange the stored refresh token for a
   * fresh session. Never leaves `isLoading` stuck (try/finally). A failed
   * bootstrap stays silent (no toast) — startup, not mid-session.
   */
  async function bootstrap(): Promise<boolean> {
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      return false
    }

    setLoading(true)
    try {
      const response = await apiClient<LoginResponse>('POST', '/api/auth/refresh', {
        refreshToken,
      })
      if (!response?.accessToken || !response.refreshToken) {
        clearAuth()
        return false
      }
      setTokens(response)
      try {
        await refreshUser()
      } catch {
        // Same half-state rule as login(): never keep tokens without a user.
        clearAuth()
        return false
      }
      return true
    } catch {
      clearAuth()
      return false
    } finally {
      setLoading(false)
    }
  }

  return {
    user,
    isLoading,
    isAuthenticated,
    setTokens,
    setUser,
    clearAuth,
    setLoading,
    login,
    register,
    refreshUser,
    logout,
    bootstrap,
  }
})
