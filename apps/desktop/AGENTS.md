# AGENTS.md — PostIt Desktop Client

Practical guide for any agent working on `apps/desktop`. Read `PLAN.FE.md`
(repo root) for the fuller design story; this file is the operative reference:
conventions, patterns, commands, and the Definition of Done.

## 1. Structure and architecture

The desktop client is a **Vue 3 + TypeScript + Vite** SPA wrapped by **Tauri 2**,
following a **feature-first layout** with a shared layer and Pinia stores:

```text
apps/desktop/src/
├── app/           # App.vue, router.ts, layouts/ (AuthLayout, BoardLayout)
├── features/      # auth, boards, notes, members — each with components/, composables/, index.ts
├── shared/        # components/{ui,layout}, composables, services, validation, types
├── stores/        # Pinia: authStore.ts, boardStore.ts, uiStore.ts
├── main.ts
└── index.css
```

Dependency direction: features may use shared + stores; shared services may read
the auth store; **stores never import components or features**. One feature does
not import another feature's internals (share via `shared/` or stores instead).

Key mechanics:

- **Components**: `<script setup lang="ts">` SFCs. UI events stay in the
  component; reusable flows live in composables; all server calls go through
  `shared/services` (`api.ts`, `signalr.ts`) — never `fetch` directly in a
  component or composable.
- **State**: three Pinia stores (auth / domain / UI); components read reactive
  state via `storeToRefs` and mutate through actions only (see §5).
- **Validation**: VeeValidate + Zod. Schemas in `shared/validation/schemas.ts`
  are the single source of truth, mirroring backend limits (board name ≤200,
  note content ≤1000, note color ≤50, role ∈ {Editor, Viewer}) — see §4.
- **Realtime**: `BoardSignalRService` in `shared/services/signalr.ts`;
  mutations are optimistic with rollback + error toast on failure.
- **Routing**: Vue Router with a global `router.beforeEach` guard
  (isLoading / isAuthenticated logic).

## 2. Coding conventions and naming

- **Components**: PascalCase SFC file names (`BoardList.vue`), one component per
  file, `<script setup lang="ts">` always; `<style scoped>` only when Tailwind
  utilities are not enough. Use PascalCase in templates for custom components.
- **Composables**: camelCase `useXxx.ts` files returning an object of reactive
  state + actions. Keep them small; split before they grow into god-objects.
- **Stores**: `defineStore('name', ...)` in `src/stores/*.ts`; state as
  refs/getters, mutations as actions. One store per domain (auth/board/ui).
- **Types**: DTO mirrors in `shared/types/api.ts`; GUIDs are strings; types
  match backend records field-for-field (manual mapping when view models differ).
- **Props/emits**: props camelCase in script; emits declared with `defineEmits`.
- **Async**: `async/await` end-to-end; abort in-flight requests on unmount where
  it matters (e.g. `AbortController` in feature composables).
- **Styling**: Tailwind utilities inline; lift repeated class combos into shared
  components rather than scattering `@apply`.
- **Formatting**: UTF-8 without BOM, CRLF line endings, final newline, 2-space
  indent (match existing files).

## 3. Patterns to follow / avoid

### Follow

- **Feature-first layout**: feature internals (`components/`, `composables/`)
  are private to the feature; cross-feature reuse goes through `shared/`.
- **Thin component / composable split**: the component renders and delegates;
  the composable orchestrates store + apiClient.
- **Typed `apiClient<T>`** for every request; `ApiError` carries
  `ProblemDetails`; exception → status → message → toast mapping (§4).
- **Optimistic updates** for drag, create and delete, with rollback and a toast
  on failure.
- **Route guards** in `router.beforeEach`; authorization-aware rendering
  (Owner/Editor/Viewer) hides actions the API would reject anyway.
- **Forms**: every text-input form uses VeeValidate `useForm`/`useField` with
  `toTypedSchema(zodSchema)` — never ad-hoc validation logic (§4).
- **Manual mapping**: explicit functions from DTO → view model when shapes
  differ; no generic mapping libraries.

### Avoid

- Direct `fetch` outside `shared/services/api.ts`.
- Storing the access token anywhere but memory (refresh token: localStorage only).
- Business logic or validation rules inside templates.
- A second validation system alongside Zod (no manual `if (value.length > …)`).
- New dependencies without stated justification.
- Dead code left behind; unrelated refactors smuggled into a diff.

## 4. API, validation and error handling

### API client

Single typed `apiClient<T>(method, path, body?)` in `shared/services/api.ts`:
Authorization from the auth store, automatic refresh on 401 with a **single**
retry, 204 → `undefined`, non-OK → parse `ProblemDetails`, throw:

```text
class ApiError extends Error { status: number; problem: ProblemDetails }
```

Endpoints (all JSON):

```text
Auth:     POST /api/auth/register, login, refresh, logout; GET /api/auth/me
Boards:   GET/POST /api/boards; GET/PUT/DELETE /api/boards/{id}
Members:  GET/POST /api/boards/{id}/members; PUT/DELETE /api/boards/{id}/members/{userId}
Notes:    GET/POST /api/boards/{id}/notes; PUT/DELETE /api/notes/{noteId}
```

### Validation

- Zod schemas (`shared/validation/schemas.ts`) mirror backend limits exactly:
  board name required ≤200, note content required ≤1000, note color required
  ≤50, role must be `"Editor" | "Viewer"`, auth fields required (email + format).
- Forms validate through VeeValidate with `toTypedSchema`; submit is disabled
  while pending; errors render inline.
- **Client validation is UX, not security** — the backend is authoritative.
- Server 400 with an `errors` dictionary → map into VeeValidate `setErrors`;
  400 with `detail` only → form-level error or toast.

### Status → message mapping

```text
400 → "Invalid input: {detail}"        (or field errors as above)
401 → "Session expired, please log in again"
403 → "You don't have permission for this action"
404 → "Resource not found"
409 → "This action conflicts with current state"
500 → "Something went wrong. Please try again."
```

Unhandled errors are caught by the global handler (`app.config.errorHandler` +
`onErrorCaptured` on the root component) → `ErrorFallback.vue` with retry.

## 5. State management (Pinia)

| Store | Owns | Persistence |
|-------|------|-------------|
| `authStore` | user, accessToken, refreshToken, isLoading; login/register/logout/refresh actions | refresh token in localStorage (via `token.ts`), access token memory only |
| `boardStore` | boards, activeBoard, members, isLoading; CRUD actions | none |
| `uiStore` | sidebarOpen, toasts, activeModal; transient actions | none |

Rules:
- Components read with `storeToRefs`, mutate only through actions.
- A store only touches its own state; cross-store needs go through actions.
- `isAuthenticated` comes from `authStore` and drives `router.beforeEach`.
- No business rules inside stores' mutation code beyond orchestration.

## 6. Testing and verification

- **Unit** (Vitest): stores (with `@pinia/testing` `createTestingPinia`),
  token management, apiClient error/refresh paths, Zod schemas.
- **Component** (Vitest + Vue Test Utils): form submissions through VeeValidate,
  rendering with props, error states.
- **Integration** (Vitest + Vue Test Utils): login → board list → create board
  → navigate; install router/pinia via `global.plugins`.
- Convention: colocated `*.test.ts` next to the source file
  (`NoteCanvas.vue` → `NoteCanvas.test.ts`).
- Not in MVP: SignalR connection (integration only), Tauri-specific APIs,
  visual styling.

Verification commands (run from `apps/desktop`):

```bash
npm test          # Vitest
npm run build     # type-check + production build
npm run lint      # ESLint + Prettier check
```

All three must pass before claiming work is done. Never silence or delete a
failing test; report it instead.

## 7. Security and secrets

- **Tokens**: access token memory only (never localStorage); refresh token in
  localStorage; `clearTokens` on logout; refresh retried once on 401.
- **Authz**: `router.beforeEach` guards routes; Owner/Editor/Viewer-aware UI
  hides actions; API 403 handled gracefully. Guards are UX — every mutation is
  re-authorized server-side.
- **XSS**: no `v-html` with user or server content; no inline event handlers
  built from strings; user content rendered as text.
- **Input**: enforce the §4 limits client-side; the server remains
  authoritative.
- **Secrets**: no tokens, passwords or credentials in logs, code or config;
  dev-only values in `.env.*`; never commit real secrets.
- **Transport**: SignalR JWT via query string (`?access_token=...`) — never log
  URLs of hub requests; API errors surface `ProblemDetails` without stack traces.

## 8. Performance

- **Rendering**: subscribe to minimal store slices (`storeToRefs` per field);
  avoid whole-store spreads in computed values; stable `:key`s in lists
  (`BoardList`, `MemberList`).
- **Drag-and-drop**: throttled position updates, optimistic apply with
  rollback, prefer `transform` over `top`/`left`, no layout thrashing.
- **SignalR**: handlers write straight to the store (no intermediate copies);
  connection-state updates isolated so they don't re-render the canvas; lean
  DTO payloads only.
- **Reactivity**: computed for derived values, `watch` with cleanup, avoid deep
  watchers on collections; no heavy work in render functions/templates.
- **Async**: abort in-flight fetches on unmount; no sync-over-async.
- **Bundle**: watch for accidentally large imports; tree-shakeable imports
  only; dynamic imports are deferred (not MVP).

## 9. Sub-agent workflow

| Agent | When to use |
|-------|-------------|
| **architect-client** | Major features, new subsystems, interface changes. Runs before code; creates and verifies the `feat/fe-<slug>` branch. |
| **implementer-client** | Default choice for writing code once the approach is decided. |
| **tester-client** | New behavior needs tests, or a change carries regression risk. |
| **reviewer-client** | Always after implementation, before considering a task done. |
| **security-reviewer-client** | Auth, tokens, localStorage, validation, XSS, SignalR client. |
| **performance-reviewer-client** | Hot render paths, drag-and-drop, SignalR realtime, list rendering, bundle. |

```text
architect-client → implementer-client → tester-client → reviewer-client
    → (security/performance review when relevant) → fix → re-test → re-review
```

Run only the review stages relevant to the change. All agents obey §10.

## 10. Agent working rules (mandatory)

- **Read the code before modifying it** — the file, its imports, neighbors.
- **Reuse existing patterns** (apiClient, stores, VeeValidate forms, toast
  mapping) instead of inventing parallel ones.
- **Keep the diff minimal.** No refactoring unless requested; mention problems
  instead of silently restructuring.
- **Never ignore failing tests / lint / build.** A red suite is a blocker.
- **No new dependencies without justification** (Zod/VeeValidate are approved).
- **Branch rule**: work happens on the `feat/fe-<slug>` branch created and
  verified by `architect-client`; if you are not on it, stop and ask.
- **Flag conflicts and ambiguity** (PLAN.FE.md vs code drift, contradictory
  requirements) instead of inventing solutions.

## 11. Definition of Done

A task on `apps/desktop` is done only when all of these hold:

- [ ] `npm test` passes (unit + component + integration).
- [ ] `npm run build` succeeds with no new warnings.
- [ ] `npm run lint` reports no new issues.
- [ ] New behavior has tests covering success and failure paths.
- [ ] Forms use VeeValidate + the shared Zod schema; limits mirror the backend.
- [ ] Errors follow the §4 status mapping; failures surface as toasts.
- [ ] State lives in Pinia stores; no server calls outside `shared/services`.
- [ ] No tokens/secrets committed, logged, or persisted beyond localStorage refresh token.
- [ ] No new dependencies without stated justification.
- [ ] Diff is minimal; no unrequested refactors.
- [ ] `PLAN.FE.md` (or this file) updated or flagged if the change makes it stale.