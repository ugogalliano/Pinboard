import { ref } from 'vue'

// Single owner of token storage (PLAN.FE.md §6, AGENTS.md §7).
// - Access token: memory only, never persisted (short-lived, XSS-safe).
// - Refresh token: localStorage only.
// This module imports nothing from stores, features or api (no cycles).

const REFRESH_TOKEN_KEY = 'postit.refreshToken'

const accessToken = ref<string | null>(null)

export function getAccessToken(): string | null {
  return accessToken.value
}

export function setAccessToken(token: string | null): void {
  accessToken.value = token
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setRefreshToken(token: string | null): void {
  if (token === null) {
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  } else {
    localStorage.setItem(REFRESH_TOKEN_KEY, token)
  }
}

export function clearTokens(): void {
  setAccessToken(null)
  setRefreshToken(null)
}
