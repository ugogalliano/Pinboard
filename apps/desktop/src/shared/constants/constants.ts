// Generic, app-wide constants — the values that belong to no feature and no
// domain. Domain-specific ones live in their own file next to their consumers
// (e.g. the sticky-note palette in ./note-colors.ts), so this file stays small
// on purpose. Every call site imports the constants from here instead of
// re-declaring its own literals.

/** The HTTP verbs the app issues (apiClient, plus the raw refresh fetch). */
export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
} as const

export type HttpMethod = (typeof HTTP_METHODS)[keyof typeof HTTP_METHODS]
