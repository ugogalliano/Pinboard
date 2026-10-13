import { toValue, type MaybeRef } from 'vue'

/**
 * Route params arrive as `string | string[]` (and can be missing entirely),
 * so the raw param is normalized ONCE, here, instead of at every call site.
 * Both the boards (`:boardId` detail) and notes (`:boardId` canvas) route
 * params flow through this helper — it is pure, so features share it without
 * importing from each other (dependency direction, AGENTS.md §1).
 */
export function normalizeRouteId(
  id: MaybeRef<string | string[] | undefined>,
): string | undefined {
  const value = toValue(id)
  if (typeof value === 'string') {
    return value === '' ? undefined : value
  }
  return Array.isArray(value) ? value[0] : undefined
}
