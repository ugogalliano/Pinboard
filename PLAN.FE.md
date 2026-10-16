# PLAN.FE.md

# PostIt Frontend — Desktop Client Plan

## 0. Scope and execution rule

This is the **frontend implementation plan** for the PostIt desktop client.

The frontend should be built incrementally, with each phase producing a runnable and testable result.

Target stack:

- Vue 3 (Composition API, `<script setup>`)
- TypeScript 5
- Tailwind CSS 3
- Vite
- Vue Router 4
- Pinia (auth and UI state)
- @tanstack/vue-query (server state: boards, notes, members)
- VeeValidate 4 + Zod (forms and validation)
- @microsoft/signalr
- Tauri 2
- Vitest + Vue Test Utils

---

## 1. Monorepo structure

The frontend lives alongside the existing backend:

```text
Pinboard/
├── apps/
│   ├── server/        # .NET backend (existing)
│   └── desktop/       # Vue + Tauri frontend (new)
├── docs/
├── PLAN.BE.md
└── PLAN.FE.md         # This file
```

The frontend is fully independent from the backend. Communication is via HTTP/WebSocket only.

> Note: `apps/desktop/` currently contains orphaned React scaffold remnants
> (`package-lock.json`, `node_modules/`, `dist/`) with no source code. Phase 1
> wipes them before scaffolding the Vue project.

---

## 2. Tech stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Build | Vite | Fast HMR, native ESM, Tauri-compatible |
| Framework | Vue 3 (Composition API, `<script setup>`) | Requirement; idiomatic, first-class TypeScript |
| Styling | Tailwind CSS 3 | Requirement |
| Language | TypeScript 5 | Type safety |
| Routing | Vue Router 4 | Official Vue router, explicit route config |
| Client state | Pinia (auth + UI) | Token lifecycle, toasts, transient UI |
| Server state | @tanstack/vue-query | Caching, dedup, invalidation, optimistic mutations |
| Forms | VeeValidate 4 + Zod | Schema-based validation, per-field errors, server-error mapping |
| HTTP | Native fetch (behind apiClient) | No extra HTTP dependency |
| Realtime | @microsoft/signalr | Official SignalR client |
| Desktop | Tauri 2 | Native desktop wrapper |
| Testing | Vitest + Vue Test Utils + jsdom | Vite-native |
| Linting | ESLint (eslint-plugin-vue) + Prettier | Code quality |

Scaffold with `npm create vue@latest` (TypeScript, Vue Router, Pinia, Vitest, ESLint, Prettier options selected), then add `@tanstack/vue-query`, `vee-validate` and `zod`.

---

## 3. Directory layout

Every component lives in a folder named after it, together with its colocated
test: `<group>/<Name>/<Name>.vue` + `<group>/<Name>/<Name>.test.ts`.

```text
apps/desktop/
├── src/
│   ├── app/
│   │   ├── App/                  # Root: global error handler, router-view
│   │   │   └── App.vue
│   │   ├── router.ts             # Route definitions + guards
│   │   └── layouts/
│   │       ├── AuthLayout/       # Unauthenticated (login/register)
│   │       │   └── AuthLayout.vue
│   │       └── BoardLayout/      # Authenticated (sidebar + canvas)
│   │           └── BoardLayout.vue
│   ├── features/
│   │   ├── auth/
│   │   │   ├── components/
│   │   │   │   ├── LoginForm/
│   │   │   │   │   └── LoginForm.vue
│   │   │   │   └── RegisterForm/
│   │   │   │       └── RegisterForm.vue
│   │   │   ├── composables/
│   │   │   │   └── useAuth.ts
│   │   │   └── index.ts
│   │   ├── boards/
│   │   │   ├── components/
│   │   │   │   ├── BoardList/
│   │   │   │   │   └── BoardList.vue
│   │   │   │   ├── BoardCard/
│   │   │   │   │   └── BoardCard.vue
│   │   │   │   ├── CreateBoardDialog/
│   │   │   │   │   └── CreateBoardDialog.vue
│   │   │   │   ├── BoardHeader/
│   │   │   │   │   └── BoardHeader.vue
│   │   │   │   └── BoardView/              # /boards/:boardId shell (header + outlet)
│   │   │   │       └── BoardView.vue       # Phase 5: the canvas child route is
│   │   │   │                               # NoteCanvas; BoardCanvasPlaceholder was removed
│   │   │   ├── composables/
│   │   │   │   ├── useBoards.ts          # useQuery/useMutation wrappers
│   │   │   │   └── useBoard.ts
│   │   │   └── index.ts
│   │   ├── notes/
│   │   │   ├── components/
│   │   │   │   ├── NoteCanvas/
│   │   │   │   │   └── NoteCanvas.vue
│   │   │   │   ├── PostItCard/
│   │   │   │   │   └── PostItCard.vue
│   │   │   │   ├── PostItEditor/
│   │   │   │   │   └── PostItEditor.vue
│   │   │   │   └── ColorPicker/
│   │   │   │       └── ColorPicker.vue
│   │   │   ├── composables/
│   │   │   │   ├── useNotes.ts           # useQuery/useMutation wrappers
│   │   │   │   └── useDragNote.ts        # live delta transform + single debounced PUT on drop
│   │   │   └── index.ts
│   │   └── members/
│   │       ├── components/
│   │       │   ├── MemberList/
│   │       │   │   └── MemberList.vue
│   │       │   ├── AddMemberDialog/
│   │       │   │   └── AddMemberDialog.vue
│   │       │   └── RoleSelect/
│   │       │       └── RoleSelect.vue
│   │       ├── composables/
│   │       │   └── useMembers.ts         # useQuery/useMutation wrappers
│   │       └── index.ts
│   ├── shared/
│   │   ├── components/
│   │   │   ├── ui/               # only Spinner/ is local: Button/Input/Dialog/
│   │   │   │                     # Toast/Toaster come from the design system
│   │   │   │                     # (@ugogalliano/pm-design-system-vue);
│   │   │   │                     # ErrorFallback is deferred (Phase 8, §13)
│   │   │   │   └── Spinner/
│   │   │   │       └── Spinner.vue
│   │   │   └── layout/
│   │   │       ├── Sidebar/
│   │   │       │   └── Sidebar.vue
│   │   │       └── Header/
│   │   │           └── Header.vue
│   │   ├── constants/
│   │   │   ├── constants.ts     # generic constants (e.g. HTTP methods)
│   │   │   ├── urls.ts          # all API URLs (single source of truth)
│   │   │   └── note-colors.ts   # sticky-note palette
│   │   ├── composables/
│   │   │   └── useDebounce.ts
│   │   │   # useSignalR.ts deferred (Phase 7 realtime)
│   │   ├── services/
│   │   │   ├── api.ts
│   │   │   ├── session.ts
│   │   │   └── token.ts
│   │   │   # signalr.ts deferred (Phase 7 realtime)
│   │   ├── validation/
│   │   │   └── schemas.ts        # Zod schemas (shared with VeeValidate)
│   │   └── types/
│   │       ├── api.ts
│   │       └── index.ts
│   ├── stores/
│   │   ├── authStore.ts          # Pinia: useAuthStore (tokens, user)
│   │   └── uiStore.ts            # Pinia: useUIStore (toasts, sidebar, modals)
│   ├── main.ts                   # createApp + VueQueryPlugin (QueryClient)
│   └── index.css
├── public/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    └── src/
        └── lib.rs
```

---

## 4. Type system

All TypeScript types mirror the backend DTOs exactly. GUIDs are strings in JSON.

```text
// src/shared/types/api.ts

// Auth
RegisterRequest    { email, password, displayName }
LoginRequest       { email, password }
LoginResponse      { accessToken, refreshToken, expiresAt }
RefreshRequest     { refreshToken }
MeResponse         { id, email, displayName }

// Boards
BoardDto           { id, name, createdBy, createdAt, updatedAt, memberCount }  // memberCount: number, required
CreateBoardRequest { name }
UpdateBoardRequest { name }

// Members
BoardMemberDto     { userId, email, displayName, role, createdAt }
AddMemberRequest   { email, role }           // role: "Editor" | "Viewer"
UpdateMemberRequest { role }                 // role: "Editor" | "Viewer"

// Notes
NoteDto            { id, boardId, createdBy?, content, color, positionX, positionY, createdAt, updatedAt }
CreateNoteRequest  { content, color, positionX, positionY }
UpdateNoteRequest  { content, color, positionX, positionY }

// Errors
ProblemDetails     { type?, title?, status, detail?, errors? }
```

`BoardDto.memberCount` is the total number of members on the board, **including the Owner**. It is returned by every board response: GET list (`['boards']`), GET detail (`['boards', boardId]`), POST create and PUT update. The backend computes it; the client never derives or increments it.

Roles:
- `BoardRole` = `"Owner" | "Editor" | "Viewer"`
- `AssignableRole` = `"Editor" | "Viewer"` (Owner not assignable by clients)

Validation constraints (frontend reference):
- Board Name: required, max 200 chars
- Note Content: required, max 1000 chars
- Note Color: required, max 50 chars
- Member Role: must be valid AssignableRole
- Auth fields: email required + valid format, password required, displayName required (register)

These constraints are encoded once as Zod schemas (§5) and are the only client-side validation source of truth.
---

## 5. Forms and validation (VeeValidate + Zod)

### Zod schemas as single source of truth

`src/shared/validation/schemas.ts` holds one Zod schema per form/DTO use case. Schemas mirror the constraints in §4 and are consumed by:

- **VeeValidate** via `toTypedSchema(zodSchema)` — one validation definition drives the whole form
- **unit tests** — schemas reject invalid input (missing fields, over-length, bad role)
- optional runtime parsing of API payloads (not in MVP)

MVP schemas: `loginSchema`, `registerSchema`, `boardNameSchema`, `noteSchema` (content + color), `memberSchema` (email + role).

### Form pattern

Each form uses VeeValidate's `useForm` + `useField` (Composition API, `<script setup>`):

```text
const { handleSubmit, errors, setErrors } = useForm({
  validationSchema: toTypedSchema(loginSchema),
})
const onSubmit = handleSubmit((values) => mutation.mutateAsync(values))
```

Rules:
- validate on submit by default; blur validation on longer forms (register, add member) is optional polish
- disable the submit button while the submission is pending (no double submits)
- never bypass the schema with ad-hoc checks — if a rule changes, change the Zod schema
- shared `Input.vue` renders VeeValidate field state (value, errors, touched) so every form looks consistent
- submissions go through a `useMutation` (§8) — forms never call apiClient directly (exception: auth submissions stay store actions (§7), not `useMutation` — they manage tokens, not cacheable server state)

### Server error mapping

- **400 with `errors` dictionary** (ValidationProblemDetails) → map keys into VeeValidate `setErrors({ field: message })`
- **400 with `detail` only** (ArgumentException messages: board name, content, color) → form-level error or toast (§13)
- **404 / 409** (member email not found, already a member, duplicate registration) → field error on the relevant field where sensible (email), otherwise toast
- **401 invalid credentials** → form-level error on the login form, not a toast

---

## 6. API client

### Design

Single typed `apiClient<T>(method, path, body?)` wrapping native `fetch`. It is the **only** HTTP layer: components never call it directly — feature composables wrap it in Vue Query `queryFn`/`mutationFn` (§8).

Flow:
1. Get accessToken from auth store
2. Set Authorization + Content-Type headers
3. Call fetch with base URL + path
4. If 401: attempt token refresh, retry once
5. If 204: return undefined
6. If not ok: parse ProblemDetails, throw ApiError
7. Return parsed JSON as T

```text
class ApiError extends Error {
  status: number
  problem: ProblemDetails
}
```

### Token management

| Concern | Storage | Rationale |
|---------|---------|-----------|
| Access token | Memory only | Short-lived (15 min), prevents XSS |
| Refresh token | localStorage | Survives restarts, 7-day lifetime |

Functions: `getAccessToken`, `setAccessToken`, `getRefreshToken`, `setRefreshToken`, `clearTokens`

### Typed endpoints

```text
Auth:     POST /api/auth/register, login, refresh, logout; GET /api/auth/me
Boards:   GET/POST /api/boards; GET/PUT/DELETE /api/boards/{id}
Members:  GET/POST /api/boards/{id}/members; PUT/DELETE /api/boards/{id}/members/{userId}
Notes:    GET/POST /api/boards/{id}/notes; PUT/DELETE /api/notes/{noteId}
```

---

## 7. Authentication

Auth flows are **not** query-cached server state — they own the token lifecycle and app bootstrap, so they stay in Pinia as explicit actions (login/register/refresh/logout), each ending in either `setTokens` + `setUser` or `clearAuth`.

### Auth store (Pinia)

```text
// src/stores/authStore.ts
interface AuthState {
  user: MeResponse | null
  isAuthenticated: boolean
  isLoading: boolean    // checking refresh token on app start
}

// Actions: login, register, logout, refreshUser, setTokens, setUser, clearAuth, setLoading
```

### App start flow

1. Check if refresh token exists in localStorage
2. If yes: call /api/auth/refresh
3. If refresh succeeds: call /api/auth/me, populate user
4. If refresh fails: clear tokens, show login
5. If no refresh token: show login immediately

### 401 recovery

1. API client intercepts 401
2. Attempt token refresh automatically
3. If refresh succeeds: retry original request (once)
4. If refresh fails: clear auth, redirect to login

On logout: `clearAuth` + `queryClient.clear()` so no board data survives in the query cache.

---

## 8. State management

Server state and client state are deliberately separated.

### Server state — @tanstack/vue-query

Boards, notes and members are server state and live **only** in the Vue Query cache:

```text
['boards']                       → GET /api/boards
['boards', boardId]              → GET /api/boards/{id}
['boards', boardId, 'notes']     → GET /api/boards/{id}/notes
['boards', boardId, 'members']   → GET /api/boards/{id}/members
```

- **Reads**: `useQuery` with the key above; `isPending` / `isError` drive spinners and error states.
- **Mutations**: `useMutation` with the standard cycle — `onMutate` (cancel queries + `setQueryData` optimistic write), `onError` (rollback + toast), `onSettled` (`invalidateQueries` on the affected keys).
- **Realtime**: SignalR events write into the same cache via `setQueryData` (§11) — one source of truth, never duplicated into a store.
- **QueryClient** (created in `main.ts` with `VueQueryPlugin`): retry once for network errors only (never for `ApiError`), `refetchOnWindowFocus: false`, `staleTime: 30_000`.

### Client state — Pinia

**Auth store** (`useAuthStore`):
```text
user, accessToken, refreshToken, isLoading
Actions: setTokens, setUser, clearAuth, setLoading (+ login/register/logout/refreshUser)
```

**UI store** (`useUIStore`, transient):
```text
sidebarOpen, activeModal
Actions: toggleSidebar, openModal, closeModal
```

Toasts are owned by the design system (`useToast()` + `<Toaster />`) — module-level global store, not Pinia state (Phase 3 decision A).

**Dialog visibility is local component state** (Phase 4 decision): board dialogs
(`CreateBoardDialog`, the delete confirmation in `BoardHeader`) own their open
state through `v-model:open` on the component itself, not `uiStore.activeModal`.
Two `BoardList` instances (home grid + sidebar nav) would contend for the same
single string slot, so `activeModal` / `openModal` / `closeModal` stay in the
store, unused by dialogs by design.

### Why this split

- Vue Query owns everything the server owns — caching, dedup, refetch, optimistic rollback. Mirroring that data in a Pinia store would create a second source of truth and re-implement what the library already does.
- `activeBoard` is not stored anywhere: it derives from the `:boardId` route param (§9).
- Auth store: token lifecycle and `isAuthenticated` for router guards.
- UI store: transient UI state isolated from data fetching.
- Components read Pinia state via `storeToRefs` and query state via `useQuery` destructuring (`data`, `isPending`, `isError`).

---

## 9. Routing

### Route tree

```text
/
├── /login          AuthLayout > LoginForm
├── /register       AuthLayout > RegisterForm
├── /               BoardLayout (protected)
│   ├── index        BoardList
│   └── /boards/:boardId
│       ├── index    NoteCanvas
│       └── /members MemberList
└── *               Navigate to /
```

### Route guards

Implemented as a global `router.beforeEach` guard:

- isLoading: await auth check on first navigation (show spinner)
- route requires auth and !isAuthenticated: redirect to /login
- guest-only route and isAuthenticated: redirect to /
- otherwise: render children

No lazy loading for MVP.
---

## 10. Layouts

### AuthLayout

```text
┌──────────────────────────────┐
│                              │
│      ┌──────────────┐        │
│      │    Logo      │        │
│      │  [LoginForm] │        │
│      │  Register    │        │
│      └──────────────┘        │
│                              │
└──────────────────────────────┘
```

### BoardLayout

```text
┌─────────┬──────────────────────────────────┐
│ Sidebar │  Header (brand, user, logout)   │
│         ├──────────────────────────────────┤
│ Boards  │                                  │
│ list    │  Content area                    │
│         │  (NoteCanvas or MemberList)      │
└─────────┴──────────────────────────────────┘
```

The shared `Header` is app chrome only — it never shows board data. The active
board's title and its Owner-only actions (rename / delete) live in the content
area, in `BoardHeader` (rendered by `BoardView`), so a board screen owns its own
heading.

---

## 11. SignalR realtime

### Connection

```text
class BoardSignalRService {
  connect to /hubs/board with JWT via query string
  auto-reconnect with exponential backoff
  joinBoard(boardId) / leaveBoard(boardId)
  onPostItCreated(note: NoteDto)
  onPostItUpdated(note: NoteDto)
  onPostItDeleted(noteId: string)
}
```

### Lifecycle

On board canvas mount (`onMounted`):
1. Start connection (if not connected)
2. joinBoard(boardId)
3. Register event handlers

On board canvas unmount (`onUnmounted`):
1. leaveBoard(boardId)
2. Unregister handlers
3. Keep connection alive (don't stop)

### Realtime → query cache

Handlers do **not** fetch or go through stores: they write into the notes query cache directly:

- `onPostItCreated` → `setQueryData(['boards', boardId, 'notes'], append(note))`
- `onPostItUpdated` → `setQueryData([...], update(note))`
- `onPostItDeleted` → `setQueryData([...], remove(noteId))`

Remote changes therefore appear instantly without a refetch. Use `invalidateQueries` only as a fallback when the payload is partial or unknown.

### Optimistic updates (Vue Query mutation cycle)

**Drag-and-drop (`useDragNote`):**
1. Optimistic `setQueryData` on `['boards', boardId, 'notes']` — move the note immediately ON COMMIT (the debounced drop); never per pointermove
2. single `PUT /api/notes/{noteId}` on drop (per-card debounced coalescing of successive drops) via `useMutation` — Phase 5 perf decision
3. `onMutate`: snapshot previous cache (and `cancelQueries` for that key)
4. `onError`: restore snapshot + error toast
5. `onSettled`: `invalidateQueries(['boards', boardId, 'notes'])`

**Create/delete:**
1. `onMutate`: `setQueryData` add/remove the note locally
2. `onError`: rollback + toast; `onSettled`: invalidate the notes key

Same cycle for boards and members mutations (create/update/delete → invalidate the affected key).

**Member mutations and `memberCount` (Phase 6 contract):** `BoardDto.memberCount` lives in the boards query data, so a membership change must refresh it through invalidation, not optimistic arithmetic.
- **Add / remove member**: `onSettled` invalidates all three keys, each with `{ exact: true }`:
  1. `['boards', boardId, 'members']` with `{ exact: true }` (the exact members key)
  2. `boardsKeys.all` with `{ exact: true }` (the exact `['boards']` list key)
  3. `['boards', boardId]` with `{ exact: true }` (the affected board detail key)
- **Role update**: `onSettled` invalidates only `['boards', boardId, 'members']` with `{ exact: true }`. Role changes do not alter the member count, so the board keys are left untouched.
- **No optimistic count changes**: add/remove must not write or increment `memberCount` in the `['boards']` / `['boards', boardId]` cache in `onMutate`. The count is only corrected by the refetch triggered by the invalidations above. Member mutations must not add per-board requests to refresh counts (no N+1 / member-list fanout on the boards list).

---

## 12. Feature modules

### Auth

| Component | Responsibility |
|-----------|---------------|
| LoginForm | VeeValidate form (`loginSchema`): email + password, submit calls authStore login(), shows field + form-level errors |
| RegisterForm | VeeValidate form (`registerSchema`): email + password + displayName, submit calls authStore register(), shows field + form-level errors |
| useAuth | Auth state + actions from auth store |

### Boards

| Component | Responsibility |
|-----------|---------------|
| BoardList | Renders the `['boards']` query (isPending → spinner, empty → empty state), "Create Board" button |
| BoardCard | Board name, created date, member count (`{{memberCount}} member(s)` from `BoardDto.memberCount`, read from the `['boards']` query data — no extra request); navigates to the board on click |
| CreateBoardDialog | Modal with VeeValidate name field (`boardNameSchema`, ≤200) → create-board mutation |
| BoardHeader | Active board title + created date + member count (`{{memberCount}} member(s)` from `BoardDto.memberCount`, read from the `['boards', boardId]` query data — no extra request), rename (Owner only), delete confirmation (Owner only) |
| BoardView | Route shell for `/boards/:boardId`: renders `BoardHeader` + the routed canvas outlet (the child route is swapped for NoteCanvas in Phase 5) |
| BoardCanvasPlaceholder | Phase 4 stand-in for the canvas. Replaced by NoteCanvas in Phase 5 (folder removed) |
| useBoards | `useQuery(['boards'])` + mutations (create/update/delete) with invalidation |
| useBoard | `useQuery(['boards', boardId])` for the single board behind the `:boardId` route param, with `keepPreviousData` so switching boards never flashes an empty header |

### Notes

| Component | Responsibility |
|-----------|---------------|
| NoteCanvas | Main board area, renders PostItCard from `['boards', boardId, 'notes']`, drag-and-drop, double-click to create |
| PostItCard | Single Post-it: content, color, position, draggable, edit/delete |
| PostItEditor | Inline editor for content + color, validated with `noteSchema` on save (≤1000 / ≤50). Save on blur/Enter, cancel on Escape |
| ColorPicker | Predefined color palette (8-10 sticky note colors) |
| useNotes | `useQuery`/`useMutation` over the notes key, optimistic create/delete, SignalR cache writes |
| useDragNote | Drag state, live transform delta, single debounced position PUT on drop (no per-move cache writes) |

Canvas behavior:
- Notes absolutely positioned within scrollable container
- Position in pixels (matching backend positionX/positionY)
- Canvas larger than viewport, scrollable both directions
- New notes spawn at the double-click point (canvas coords, scroll-compensated) — Phase 5 decision

### Members

| Component | Responsibility |
|-----------|---------------|
| MemberList | Members with role badges. Owner-only actions visible. |
| AddMemberDialog | VeeValidate form (`memberSchema`: email + role selector) → add-member mutation |
| RoleSelect | Dropdown to change role (Editor/Viewer). Owner not changeable. |
| useMembers | `useQuery`/`useMutation` over the members key (add/update/remove + invalidation) |

Authorization-aware rendering:
- Owner: add member, change role, remove member
- Editor: member list (read-only)
- Viewer: member list (read-only)

### Shared UI

| Component | Responsibility |
|-----------|---------------|
| Button | Primary/secondary/ghost variants, loading, disabled |
| Input | Label, error state, placeholder, password variant; integrates with VeeValidate field state |
| Dialog | Modal overlay, title, content. Uses dialog element. |
| Toast | Non-blocking notification, auto-dismiss 3s, success/error/info |
| Spinner | Loading indicator, centered or inline |
| ErrorFallback | Fallback UI shown by the global error handler with retry |
| Sidebar | Board list navigation, collapsible |
| Header | App chrome: PostIt brand, who is signed in, log out (no board-specific content) |

---

## 13. Error handling

### Four layers

1. **API Client**: intercepts responses, parses ProblemDetails, throws ApiError, handles 401 refresh/retry.
2. **Vue Query**: mutation `onError` → status-to-message mapping → toast (plus cache rollback for optimistic flows); query `isError` → component error state with retry affordance. Retry policy: one retry for network errors only, never for `ApiError` (4xx/5xx are final — the backend already decided).
3. **Forms**: VeeValidate validates client-side via Zod; server validation errors (400 `errors` dictionary) are mapped into field errors (§5).
4. **Global error handler**: `app.config.errorHandler` + `onErrorCaptured` at app root catches unhandled errors, shows ErrorFallback UI with retry.

### Status mapping

```text
400 → "Invalid input: {detail}"        (or field errors via §5)
401 → "Session expired, please log in again"
403 → "You don't have permission for this action"
404 → "Resource not found"
409 → "This action conflicts with current state"
500 → "Something went wrong. Please try again."
```
---

## 14. Testing

### Strategy

| Layer | Tool | What to test |
|-------|------|-------------|
| Unit | Vitest | Stores (auth/ui), token management, API client errors, Zod schemas, query/mutation logic |
| Component | Vitest + Vue Test Utils | Form submissions (VeeValidate), rendering with props, error states |
| Integration | Vitest + Vue Test Utils | Full flows: login → board list → create board → navigate |
| E2E | (deferred) | Full app flow in Tauri. Not in MVP. |

Test setup: each test installs its own plugins via `global.plugins`:
- Pinia — `@pinia/testing` `createTestingPinia` for store isolation
- Vue Router — memory history with the routes under test
- Vue Query — a **fresh `QueryClient` per test** with `retry: false`
- Network — intercepted with **MSW** (`msw/node`, infra in `test/msw/`); handlers declared per test via `server.use(...)` with `onUnhandledRequest: 'error'`
- Assertions — method/path/order via the request log (`requestLog` / `callsTo(path, method?)`, the optional method filter disambiguates a path used by several verbs); bodies and the `Authorization` header captured inside the handler closure, never in a life-cycle listener

### File convention

```text
features/notes/
├── components/
│   └── NoteCanvas/
│       ├── NoteCanvas.vue
│       └── NoteCanvas.test.ts
├── composables/
│   ├── useNotes.ts
│   └── useNotes.test.ts
```

### Not tested in MVP

- SignalR connection (test via integration)
- Tauri-specific APIs (test web version first)
- Visual styling (manual QA)

---

## 15. Tauri configuration

### tauri.conf.json

```json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "PostIt",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true
      }
    ]
  }
}
```

### Vite proxy

```text
/api → https://localhost:5001 (secure: false)
/hubs → https://localhost:5001 (ws: true, secure: false)
```

Base path: `"./"` for Tauri compatibility.

---

## 16. Development workflow

```bash
# Terminal 1: Backend
cd apps/server/src/PostIt.Api && dotnet run

# Terminal 2: Frontend (Tauri dev)
cd apps/desktop && npm run tauri dev
```

Build commands:
```bash
npm run dev          # Vite dev server (browser)
npm run tauri dev    # Vite + Tauri window (desktop)
npm run build        # Vite build → dist/
npm run tauri build  # Platform-specific binaries
npm test             # Vitest
```

---

## 17. Known backend gaps (frontend awareness)

1. SignalR JoinBoard only checks authentication, not board membership. Frontend should not rely on this for security.
2. Note content validated at 1000 chars app-level, but EF config allows 2000. Frontend should enforce 1000.
3. AuthService.RegisterAsync creates User twice. If touching auth, clean up.

---

## 18. Explicitly out of scope for frontend MVP

- Comments on notes
- File attachments
- Offline support / sync
- Advanced search
- Notifications (push/email)
- Public share links
- Version history
- Analytics
- E2E tests
- Performance optimization beyond basics
---

## 19. Implementation phases

### Phase 1 — Project skeleton

Tasks:
- wipe the orphaned React remnants in `apps/desktop/` (`package-lock.json`, `node_modules/`, `dist/`)
- scaffold with `npm create vue@latest` (TypeScript, Vue Router, Pinia, Vitest, ESLint, Prettier)
- add dependencies: `@tanstack/vue-query`, `vee-validate`, `zod`
- configure Tailwind CSS
- set up Tauri 2 (src-tauri/)
- configure path aliases (@/ → src/)
- configure Vite proxy for /api and /hubs
- create directory structure
- verify ESLint + Prettier

Acceptance criteria:
- `npm run dev` starts Vite dev server
- `npm run tauri dev` opens Tauri window with hot reload
- Tailwind classes work

Commit:
```text
chore: initialize frontend project
```

---

### Phase 2 — Shared layer

Tasks:
- implement TypeScript types (types/api.ts)
- implement Zod schemas (validation/schemas.ts) mirroring §4 constraints
- implement token management (services/token.ts)
- implement apiClient with error handling and token refresh (services/api.ts)
- implement ApiError class
- set up Vue Query: `VueQueryPlugin` in main.ts, `QueryClient` defaults (network-error retry only, `refetchOnWindowFocus: false`, `staleTime: 30_000`)
- build shared UI components: Button, Input, Dialog, Toast, Spinner, ErrorFallback
- implement Pinia stores: authStore, uiStore
- set up VeeValidate (register `useForm`/`useField`, `toTypedSchema` convention)
- implement useDebounce composable

Acceptance criteria:
- apiClient can make typed requests
- Token refresh works automatically on 401
- QueryClient defaults applied (verifiable via Vue Query devtools / a smoke query)
- UI components render with correct variants
- auth/UI stores are functional
- Zod schemas reject invalid input in unit tests

Commit:
```text
feat: add shared layer (types, api client, ui components, stores)
```

---

### Phase 3 — Authentication

Tasks:
- implement auth store actions and `useAuth` composable
- build LoginForm component (VeeValidate + `loginSchema`)
- build RegisterForm component (VeeValidate + `registerSchema`)
- build AuthLayout
- implement route guards (`router.beforeEach`)
- set up Vue Router with /login and /register routes
- clear the query cache on logout (`queryClient.clear()`)
- test auth flow end-to-end

Acceptance criteria:
- user can register with email/password/displayName
- user can login and receive tokens
- user sees /api/auth/me data after login
- invalid input shows inline field errors without submitting (VeeValidate)
- invalid credentials show a form-level error
- protected routes redirect to /login when unauthenticated
- refresh token persists across app restarts
- 401 during session triggers automatic refresh
- logout leaves no board data in the query cache

Commit:
```text
feat: add authentication
```

---

### Phase 4 — Boards

Tasks:
- implement useBoards composable (`useQuery(['boards'])` + create/update/delete mutations with invalidation)
- implement useBoard composable (single board query)
- build BoardList component
- build BoardCard component
- build CreateBoardDialog component (VeeValidate + `boardNameSchema`)
- build BoardHeader component
- build Sidebar component (board list navigation)
- build Header component
- build BoardLayout (sidebar + header + content area)
- add /boards/:boardId routes to the router

Acceptance criteria:
- authenticated user sees their boards
- user can create a new board
- board name over 200 chars is rejected client-side with an inline error
- user can navigate to a board
- user can rename a board (Owner only)
- user can delete a board (Owner only)
- board list updates after create/delete (query invalidation)
- unauthorized actions are hidden/disabled

Commit:
```text
feat: add boards
```

---

### Phase 5 — Notes (core)

Tasks:
- implement useNotes composable (`useQuery`/`useMutation` over `['boards', boardId, 'notes']`)
- implement useDragNote composable (drag state, single PUT on drop with per-note coalescing and optimistic `setQueryData` + rollback)
- build NoteCanvas component (scrollable, absolutely positioned notes)
- build PostItCard component (content, color, draggable)
- build PostItEditor component (inline edit, `noteSchema` validation, save on blur/Enter)
- build ColorPicker component (predefined palette)
- add double-click-to-create on canvas
- implement optimistic create/delete via the mutation cycle (`onMutate` → `onError` rollback → `onSettled` invalidate)

Acceptance criteria:
- notes load for a board
- user can create a note (double-click)
- user can edit note content and color
- content over 1000 chars is rejected client-side with an inline error
- user can drag notes to reposition
- failed drag/create/delete rolls back the cache and shows an error toast
- user can delete notes
- position changes persist to backend
- notes survive app restart
- concurrent changes via SignalR update the canvas (Phase 7 will refine)

Commit:
```text
feat: add notes canvas
```

---

### Phase 6 — Members

Tasks:
- implement useMembers composable (`useQuery`/`useMutation` over the members key)
- implement the member cache contract (§8): add/remove invalidate the exact members key, `boardsKeys.all` (`exact: true`), and the affected board detail key (`exact: true`); role update invalidates only the members key (`{ exact: true }` on every invalidation). No optimistic `memberCount` changes
- build MemberList component
- build AddMemberDialog component (VeeValidate + `memberSchema`)
- build RoleSelect component
- implement authorization-aware rendering (Owner/Editor/Viewer)
- add /boards/:boardId/members route

Acceptance criteria:
- Owner can view member list
- Owner can add a member by email
- Owner can change member role
- Owner can remove a member
- board member count (BoardCard and BoardHeader) reflects add/remove after invalidation, with no optimistic count change
- Owner cannot be removed
- Editor sees member list (read-only)
- Viewer sees member list (read-only)
- duplicate member is rejected with an error
- invalid email/role shows inline field errors client-side
- invalid role is rejected by the backend

Commit:
```text
feat: add board members
```

---

### Phase 7 — Realtime

Tasks:
- implement BoardSignalRService (connect, reconnect, join/leave)
- wire PostItCreated event to the notes query cache (`setQueryData`)
- wire PostItUpdated event to the notes query cache (`setQueryData`)
- wire PostItDeleted event to the notes query cache (`setQueryData`)
- join board group on canvas `onMounted`
- leave board group on canvas `onUnmounted`
- handle connection state (connected/disconnected/reconnecting)
- add connection status indicator in UI

Acceptance criteria:
- user connects to SignalR on board canvas mount
- user joins board group
- note created by another user appears in real-time (no refetch)
- note updated by another user updates in real-time
- note deleted by another user is removed in real-time
- connection loss shows status indicator
- reconnection works automatically

Commit:
```text
feat: add realtime board collaboration
```

---

### Phase 8 — Polish

Tasks:
- integrate global error handler (`app.config.errorHandler` + `onErrorCaptured`) at app root
- add loading states (spinners) for all async operations (query `isPending`)
- add empty states (no boards, no notes, no members)
- add toast notifications for all success/error flows
- adjust layout for Tauri window sizes
- add keyboard shortcuts (Escape to close dialogs, etc.)
- final cleanup and code review

Acceptance criteria:
- all loading states show spinners
- all error states show toasts
- empty states have helpful messages
- app looks correct at 800x600 and 1280x800
- no console errors
- `npm run build` succeeds
- all tests pass

Commit:
```text
feat: polish frontend MVP
```

---

## 20. Frontend MVP acceptance criteria

Frontend MVP is complete only when all of these are true:

- [ ] Vite project initializes and builds
- [ ] Tauri window opens with hot reload
- [ ] Tailwind CSS works
- [ ] User can register
- [ ] User can login
- [ ] Token refresh works automatically
- [ ] Invalid input shows inline field errors (VeeValidate + Zod)
- [ ] Client-side limits mirror backend (board 200 / content 1000 / color 50)
- [ ] Server data (boards/notes/members) flows only through vue-query — no duplicated domain stores
- [ ] User sees their boards
- [ ] User can create a board
- [ ] User can navigate to a board
- [ ] User can rename/delete a board (Owner)
- [ ] Notes load for a board
- [ ] User can create a note (double-click)
- [ ] User can edit note content and color
- [ ] User can drag notes to reposition
- [ ] User can delete notes
- [ ] Position changes persist
- [ ] Failed optimistic actions roll back with an error toast
- [ ] Members can be added/removed (Owner)
- [ ] Role changes work (Owner)
- [ ] Authorization-aware UI (Owner/Editor/Viewer)
- [ ] SignalR realtime updates work (query cache writes)
- [ ] Connection status indicator shows
- [ ] Error toasts appear for failures
- [ ] Loading states show spinners
- [ ] Empty states show helpful messages
- [ ] Unit tests pass
- [ ] Component tests pass

---

## 21. First concrete milestone

The first milestone is intentionally small:

```text
Vite + Vue 3 + TypeScript
   +
Tailwind CSS
   +
Tauri 2
   +
Project structure
   +
Dev server works
```

Only after this milestone is working should authentication be implemented.

The objective is not to "build the whole frontend" in one pass.

The objective is to establish a solid local foundation and then grow the frontend one verified capability at a time.