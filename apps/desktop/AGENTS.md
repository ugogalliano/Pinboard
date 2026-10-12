# AGENTS.md — PostIt Desktop Client

Practical guide for any agent working on `apps/desktop`. Read `PLAN.FE.md`
(repo root) for the fuller design story; this file is the operative reference:
conventions, patterns, commands, and the Definition of Done.

## 1. Structure and architecture

The desktop client is a **Vue 3 + TypeScript + Vite** SPA wrapped by **Tauri 2**,
following a **feature-first layout** with a shared layer, Pinia stores and a
Vue Query data layer:

```text
apps/desktop/src/
├── app/           # App/App.vue, router.ts, layouts/ (AuthLayout/, BoardLayout/)
├── features/      # auth, boards, notes, members — each with components/<Name>/<Name>.vue, composables/, index.ts
├── shared/        # components/{ui,layout}/<Name>/<Name>.vue, composables, services, validation, types
│   └── constants/ # constants.ts (generic, e.g. HTTP methods), urls.ts (all API URLs), note-colors.ts
├── stores/        # Pinia: authStore.ts, uiStore.ts
├── main.ts        # createApp + VueQueryPlugin (QueryClient)
└── index.css
```

Dependency direction: features may use shared + stores; shared services may read
the auth store; **stores never import components or features**. One feature does
not import another feature's internals (share via `shared/` or stores instead).

Key mechanics:

- **Components**: `<script setup lang="ts">` SFCs. UI events stay in the
  component; reusable flows live in composables; every server call goes through
  `shared/services/api.ts` **invoked from a Vue Query `queryFn`/`mutationFn`** —
  never `fetch` (or a bare `apiClient` call) directly in a component.
- **Server state**: `@tanstack/vue-query` — boards, notes and members live only
  in the query cache (`['boards']`, `['boards', boardId, 'notes']`,
  `['boards', boardId, 'members']`). Reads use `useQuery`, mutations use
  `useMutation` with the cycle optimistic write (`onMutate`) → rollback
  (`onError`) → invalidate (`onSettled`). Never mirror query data into Pinia.
- **Client state**: Pinia — `authStore` (tokens, user) and `uiStore` (sidebar,
  modals). Notifications are NOT store state: the design system owns toasts
  (`useToast()` + `<Toaster />`). `activeBoard` derives from the `:boardId`
  route param, not from a store.
- **Validation**: VeeValidate + Zod. Schemas in `shared/validation/schemas.ts`
  are the single source of truth, mirroring backend limits (board name ≤200,
  note content ≤1000, note color ≤50, role ∈ {Editor, Viewer}) — see §4.
- **Realtime**: `BoardSignalRService` in `shared/services/signalr.ts`;
  events write straight into the query cache (`setQueryData`), mutations are
  optimistic with rollback + error toast on failure.
- **Routing**: Vue Router with a global `router.beforeEach` guard
  (isLoading / isAuthenticated logic).

## 2. Coding conventions and naming

- **Components**: one component per folder, both PascalCase — the file lives at
  `<group>/<ComponentName>/<ComponentName>.vue` with its colocated test at
  `<group>/<ComponentName>/<ComponentName>.test.ts`. `<script setup lang="ts">`
  always; `<style scoped>` only when Tailwind utilities are not enough. Use
  PascalCase in templates for custom components. Blocks in every SFC are ordered
  template → script setup → style (a style block is added last, only when
  Tailwind utilities are not enough).
- **Composables**: camelCase `useXxx.ts` files returning an object of reactive
  state + actions. Feature composables wrap `useQuery`/`useMutation` and own the
  query keys for their feature. Keep them small; split before they grow into
  god-objects.
- **Query keys**: array keys defined next to their composable (e.g.
  `['boards', boardId, 'notes']`); consumers reference the exported key
  factory — no ad-hoc key strings scattered around the codebase.
- **Stores**: `defineStore('name', ...)` in `src/stores/*.ts`; state as
  refs/getters, mutations as actions. One store per domain (auth/ui) — server
  data does not go here.
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
  the composable owns query keys, `queryFn`/`mutationFn` (calling `apiClient`)
  and the mutation cycle.
- **Typed `apiClient<T>`** for every request; `ApiError` carries
  `ProblemDetails`; exception → status → message → toast mapping (§4).
- **Vue Query mutation cycle** for writes: `onMutate` (cancel + optimistic
  `setQueryData`), `onError` (rollback + toast), `onSettled`
  (`invalidateQueries` on the affected keys).
- **Route guards** in `router.beforeEach`; authorization-aware rendering
  (Owner/Editor/Viewer) hides actions the API would reject anyway.
- **Forms**: every text-input form uses VeeValidate `useForm`/`useField` with
  `toTypedSchema(zodSchema)` — never ad-hoc validation logic (§4).
- **Manual mapping**: explicit functions from DTO → view model when shapes
  differ; no generic mapping libraries.

### Avoid

- Direct `fetch` outside `shared/services/api.ts` — and no bare `apiClient`
  calls from components (go through `useQuery`/`useMutation`).
- Duplicating query data into Pinia (two sources of truth) or re-implementing
  caching/refetch logic by hand.
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

It is consumed exclusively through Vue Query: `queryFn` for reads,
`mutationFn` for writes. QueryClient defaults (set in `main.ts`): one retry for
network errors only (never for `ApiError`), `refetchOnWindowFocus: false`,
`staleTime: 30_000`.

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
  while pending; errors render inline; submissions go through a `useMutation`.
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

Mutation `onError` performs this mapping → toast (plus cache rollback when the
flow was optimistic). Query `isError` renders a component-level error state with
a retry affordance. Unhandled errors are caught by the global handler
(`app.config.errorHandler` + `onErrorCaptured` on the root component) →
`ErrorFallback.vue` with retry.

## 5. State management

Two stores plus the query cache — server data never lands in Pinia:

| Store / cache | Owns | Persistence |
|-------|------|-------------|
| **Vue Query cache** | boards, notes, members (`useQuery` reads, `useMutation` writes, SignalR `setQueryData`) | in-memory cache; cleared on logout via `queryClient.clear()` |
| `authStore` | user, accessToken, refreshToken, isLoading; login/register/logout/refresh actions | refresh token in localStorage (via `token.ts`), access token memory only |
| `uiStore` | sidebarOpen, activeModal; transient actions (toasts live in the design system's `useToast()`, not here). `activeModal` is retained but unused by dialogs by design — Phase 4 dialogs own their open state locally via `v-model:open`, because two `BoardList` instances would contend for the single string slot | none |

Rules:
- Components read Pinia state with `storeToRefs` and query state via
  `useQuery` (`data`, `isPending`, `isError`); mutate stores only through
  actions; mutate query data only through the mutation cycle / `setQueryData`
  in SignalR handlers.
- A store only touches its own state; cross-store needs go through actions.
- `isAuthenticated` comes from `authStore` and drives `router.beforeEach`.
- `activeBoard` derives from the route param — never cached in a store.
- Auth calls (login/register/refresh/logout) stay in `authStore` actions — they
  manage tokens, not cacheable server state.
- No business rules inside stores' mutation code beyond orchestration.

## 6. Testing and verification

- **Unit** (Vitest): stores (with `@pinia/testing` `createTestingPinia`),
  token management, apiClient error/refresh paths, Zod schemas, query/mutation
  logic (fresh `QueryClient` per test with `retry: false`, mocked `queryFn`).
- **Network mocking** (MSW): all HTTP is intercepted with `msw/node`; the infra
  lives in `test/msw/` — outside `src/`, so it is never bundled. Type-check
  split: the APP project (`tsconfig.app.json`) excludes tests
  (`src/**/*.test.ts`, `src/**/__tests__/*`); the VITEST project
  (`tsconfig.vitest.json`) type-checks `src/**/*.test.ts`,
  `src/**/__tests__/*` and `test/**/*`. Each test declares only the handlers it
  needs via `server.use(http.get/post/…, () => HttpResponse.json(…))`; the
  shared setup runs with `onUnhandledRequest: 'error'`, so any un-mocked request
  fails loudly. Assert method/path/order through the request log (`requestLog` /
  `callsTo(path, method?)` — the optional `method` narrows a path that serves
  more than one verb); assert bodies and the `Authorization` header by capturing
  them inside the handler closure — **never** read `request.body` /
  `request.json()` in a life-cycle listener (MSW locks the stream there).
  A `204` is `new HttpResponse(null, { status: 204 })`.
- **Component** (Vitest + Vue Test Utils): form submissions through VeeValidate,
  rendering with props, error states.
- **Integration** (Vitest + Vue Test Utils): login → board list → create board
  → navigate; install router/pinia/vue-query via `global.plugins`.
- Convention: unit/component suites are colocated (`X.test.ts` next to the
  component/composable, e.g. `NoteCanvas.vue` → `NoteCanvas.test.ts`), while
  cross-cutting integration suites live in `src/app/__tests__/`.
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
  localStorage; `clearTokens` on logout; refresh retried once on 401; query
  cache cleared on logout (`queryClient.clear()`).
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
  query state through the owning `useQuery` only; stable `:key`s in lists
  (`BoardList`, `MemberList`).
- **Query cache**: precise keys and targeted `invalidateQueries` (invalidate
  the affected key, never everything); rely on `staleTime` instead of
  refetching on every mount; no broad `refetchOnWindowFocus` churn.
- **Drag-and-drop**: throttled position updates, optimistic `setQueryData` with
  rollback, prefer `transform` over `top`/`left`, no layout thrashing.
- **SignalR**: handlers write straight into the query cache
  (`setQueryData` — no refetch storms); connection state updates isolated so
  they don't re-render the canvas; lean DTO payloads only.
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
- **Reuse existing patterns** (apiClient, vue-query cycle, stores, VeeValidate
  forms, toast mapping) instead of inventing parallel ones.
- **Keep the diff minimal.** No refactoring unless requested; mention problems
  instead of silently restructuring.
- **Never ignore failing tests / lint / build.** A red suite is a blocker.
- **No new dependencies without justification** (Vue, Pinia, vue-query,
  VeeValidate, Zod, MSW are approved).
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
- [ ] Server data flows through vue-query only (queryFn/mutationFn); no
      duplicated domain state in stores.
- [ ] Mutations follow the optimistic → rollback → invalidate cycle where an
      optimistic UX applies.
- [ ] Forms use VeeValidate + the shared Zod schema; limits mirror the backend.
- [ ] Errors follow the §4 status mapping; failures surface as toasts.
- [ ] Client state lives in Pinia (auth/UI); no server calls outside
      `shared/services`.
- [ ] No tokens/secrets committed, logged, or persisted beyond localStorage
      refresh token.
- [ ] No new dependencies without stated justification.
- [ ] Diff is minimal; no unrequested refactors.
- [ ] `PLAN.FE.md` (or this file) updated or flagged if the change makes it stale.