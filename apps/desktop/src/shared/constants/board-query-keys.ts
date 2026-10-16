/**
 * Board query keys — the single source of truth for the `['boards', …]`
 * namespace (AGENTS.md §2). Deliberately PLAIN arrays / functions taking an
 * id: the positional `setQueryData` / `getQueryData` / `removeQueries`
 * overloads do NOT unwrap getter-style entries (`() => id`), so a reactive
 * factory here would write to a different key than observers subscribe to.
 *
 * The prefix layout leaves room for the later phases:
 * `['boards']` (list), `['boards', boardId]` (detail) — Phase 5/6 append
 * `['boards', boardId, 'notes']` / `['boards', boardId, 'members']`.
 */
export const boardsKeys = {
  all: ['boards'] as const,
  detail: (id: string) => ['boards', id] as const,
}
