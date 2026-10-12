/**
 * Every API URL the app calls — the single source of truth for the backend
 * surface (the same one-definition rule the Zod schemas follow).
 *
 * RULE: call sites import from here (or from a composable that did); never
 * inline an `/api/...` path in production code. Tests keep their literals —
 * they stub `fetch` by URL and are not call sites.
 *
 * The registry mirrors the full API surface of AGENTS.md §4 / PLAN.FE.md §4:
 * the notes and members entries are declared here even though their phases are
 * not wired yet, so a new call site has exactly one place to import from.
 * Parameterized paths are functions — no caller concatenates ids by hand.
 */
export const API_URLS = {
  /** Root of every backend route (the Vite proxy forwards `/api`). */
  base: '/api',

  auth: {
    /**
     * The `/api/auth/` prefix, used by `shouldSkipAutoRefresh` to detect auth
     * paths (matching ignores any query string).
     */
    authPrefix: '/api/auth/',
    register: '/api/auth/register',
    login: '/api/auth/login',
    refresh: '/api/auth/refresh',
    logout: '/api/auth/logout',
    me: '/api/auth/me',
  },

  boards: {
    list: '/api/boards',
    detail: (boardId: string) => `/api/boards/${boardId}`,
  },

  notes: {
    list: (boardId: string) => `/api/boards/${boardId}/notes`,
    detail: (noteId: string) => `/api/notes/${noteId}`,
  },

  members: {
    list: (boardId: string) => `/api/boards/${boardId}/members`,
    detail: (boardId: string, memberUserId: string) =>
      `/api/boards/${boardId}/members/${memberUserId}`,
  },
} as const
