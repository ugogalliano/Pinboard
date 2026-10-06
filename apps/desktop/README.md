# PostIt — Desktop Client (`apps/desktop`)

The PostIt desktop client: a **Vue 3 + TypeScript + Vite** SPA styled with
**Tailwind CSS 3**, wrapped by **Tauri 2**. Server state lives in
`@tanstack/vue-query`, client state in Pinia, forms use VeeValidate + Zod, and
realtime updates come over SignalR. See `PLAN.FE.md` (repo root) for the full
design and `AGENTS.md` for the operative conventions.

## Scripts

| Command               | What it does                                            |
| --------------------- | ------------------------------------------------------- |
| `npm run dev`         | Vite dev server at http://localhost:5173 (browser mode) |
| `npm run build`       | `vue-tsc` type-check + production build to `dist/`      |
| `npm test`            | Vitest unit/component tests (single run)                |
| `npm run test:unit`   | Vitest (watch mode)                                     |
| `npm run lint`        | oxlint + ESLint (+ Prettier via config)                 |
| `npm run format`      | Prettier write for `src/`                               |
| `npm run tauri dev`   | Vite dev server + Tauri desktop window (hot reload)     |
| `npm run tauri build` | Platform-specific desktop bundles                       |

## Backend proxy

The dev server proxies `/api` and `/hubs` (WebSocket) to the PostIt API.
The target is configurable:

```powershell
$env:VITE_PROXY_TARGET = "https://localhost:7113"   # e.g. per launchSettings profile
npm run dev
```

Default fallback: `https://localhost:7113` (the actual Kestrel https profile —
PLAN.FE.md §15 says `5001`; see the note in `vite.config.ts`).

## Prerequisites

- Node.js `^20.19.0 || ^22.18.0 || >=24.0.0` (verified green on 20.20.2).
- **Rust toolchain (`cargo`) required for `npm run tauri dev` / `tauri build`.**
  Without it, the CLI fails with
  `failed to run 'cargo metadata' command ... program not found`. Pure web
  development (`dev`, `build`, `test`) does not need Rust.
