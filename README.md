# PostIt (Pinboard)

A collaborative pinboard: users create boards, invite members with roles
(Owner / Editor / Viewer) and arrange sticky notes on a shared canvas in
realtime.

Monorepo with two applications:

| App          | What it is                                              | Location        |
| ------------ | ------------------------------------------------------- | --------------- |
| **Backend**  | ASP.NET Core Web API (.NET 8, Clean Architecture)       | `apps/server/`  |
| **Frontend** | Vue 3 SPA wrapped in a Tauri 2 desktop app              | `apps/desktop/` |

---

## Stack at a glance

| Backend (`apps/server`)               | Frontend (`apps/desktop`)                                |
| ------------------------------------- | -------------------------------------------------------- |
| .NET 8 / ASP.NET Core                 | Vue 3 + TypeScript + Vite                                |
| Clean Architecture (Domain / Application / Infrastructure / Api) | Tailwind CSS 3, design-system components |
| EF Core 8 + Npgsql + PostgreSQL 16    | Server state: `@tanstack/vue-query` · client state: Pinia |
| JWT auth (access + rotating refresh)  | Forms: VeeValidate + Zod                                 |
| SignalR realtime board updates        | Realtime: `@microsoft/signalr`                           |
| xUnit + Moq + Testcontainers          | Vitest + Vue Test Utils + MSW · Tauri 2 desktop bundle   |

---

## Repository structure

```text
Pinboard/
├── apps/
│   ├── server/          # .NET 8 API + tests (see apps/server/README.md)
│   └── desktop/         # Vue 3 + Tauri 2 client (see apps/desktop/README.md)
├── docs/
│   ├── PLAN.BE.md       # Backend design plan
│   └── guida-dotnet-web-api.md
├── PLAN.FE.md           # Frontend design plan
└── README.md            # You are here
```

Each app also carries an `AGENTS.md` with its working conventions and
Definition of Done.

---

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Docker](https://www.docker.com/) — for the local PostgreSQL container (and
  Testcontainers in the integration tests)
- Node.js `^20.19.0 || ^22.18.0 || >=24.0.0`
- [Rust toolchain](https://www.rust-lang.org/) (`cargo`) — **only** for
  `npm run tauri dev` / `tauri build`; pure web development does not need it
- EF Core CLI (only for migrations): `dotnet tool install --global dotnet-ef`

---

## Quick start

Run the backend and the frontend in two terminals.

### 1. Backend (API + database)

```bash
cd apps/server

# Start PostgreSQL 16 on localhost:5432 (db/user/password: postit)
docker compose up -d

# Apply migrations
dotnet ef database update --project src/PostIt.Api --startup-project src/PostIt.Api

# Run the API (Development → Swagger UI at /swagger)
dotnet run --project src/PostIt.Api --launch-profile https
```

The API listens on `https://localhost:7113` / `http://localhost:5180`.

### 2. Frontend (desktop client)

```bash
cd apps/desktop
npm install

# Browser mode (Vite dev server at http://localhost:5173)
npm run dev

# ...or native desktop window with hot reload (requires Rust)
npm run tauri dev
```

The Vite dev server proxies `/api` and `/hubs` (WebSocket) to the API. If you
ran the API with a different profile, point the proxy at it:

```powershell
$env:VITE_PROXY_TARGET = "http://localhost:5180"   # PowerShell
# VITE_PROXY_TARGET=http://localhost:5180 npm run dev   # bash
```

### 3. Verify everything

| Where        | Commands                                             |
| ------------ | ---------------------------------------------------- |
| `apps/server`  | `dotnet build` · `dotnet test`                   |
| `apps/desktop` | `npm run build` · `npm test` · `npm run lint`    |

---

## Documentation map

| I want to…                                   | Read this                                          |
| -------------------------------------------- | -------------------------------------------------- |
| Run, configure or publish the API             | [`apps/server/README.md`](apps/server/README.md)   |
| Understand the backend layers and domain model | [`apps/server/ARCHITECTURE.md`](apps/server/ARCHITECTURE.md) |
| See the backend design story                  | [`docs/PLAN.BE.md`](docs/PLAN.BE.md)               |
| Use the frontend scripts / dev proxy          | [`apps/desktop/README.md`](apps/desktop/README.md) |
| See the frontend design story                 | [`PLAN.FE.md`](PLAN.FE.md)                         |
| Contribute following the project conventions  | [`apps/server/AGENTS.md`](apps/server/AGENTS.md) · [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) |

---

## Testing

- **Backend** — `dotnet test` from `apps/server`.
  - `PostIt.UnitTests`: xUnit + Moq, no external dependencies.
  - `PostIt.IntegrationTests`: real HTTP pipeline via `WebApplicationFactory`,
    Testcontainers PostgreSQL when Docker is available, automatic SQLite
    fallback otherwise.
- **Frontend** — `npm test` (single run) or `npm run test:unit` (watch) from
  `apps/desktop`. Unit, component and integration suites (Vitest + Vue Test
  Utils); all HTTP is mocked with MSW.

---

## Deploying to production

> **Status:** the project currently targets local development. Before a real
> deployment, close the gaps listed in [Production readiness
> checklist](#production-readiness-checklist) — several of them (CORS, SignalR
> hub authorization) are deliberate open items.

### Backend

The publish step is the same in every scenario:

```bash
cd apps/server
dotnet publish src/PostIt.Api/PostIt.Api.csproj -c Release -o ./publish
```

Configuration is supplied through environment variables (the base
`appsettings.json` ships without secrets):

```bash
ASPNETCORE_ENVIRONMENT="Production"
ASPNETCORE_URLS="http://0.0.0.0:8080"
ConnectionStrings__DefaultConnection="Host=...;Port=5432;Database=postit;Username=...;Password=..."
JwtSettings__Secret="<at-least-32-characters-secret>"
```

Migrations are a deploy step: run
`dotnet ef database update --project src/PostIt.Api --startup-project src/PostIt.Api`
(or an equivalent SQL job) **before** starting the new API version.

Possible hosting models:

| Option | How | Notes |
| ------ | --- | ----- |
| **Containers on a PaaS** (Azure App Service for Containers, AWS ECS/App Runner, Google Cloud Run, Fly.io) | Add a `Dockerfile` (multi-stage: `sdk:8.0` build → `aspnet:8.0` runtime) and push the image; the platform injects env vars/secrets | **No Dockerfile is committed yet for the API** — only `docker-compose.yml` for local Postgres. Cloud Run and some platforms need explicit `--scale` / idle settings for SignalR websockets. |
| **Docker Compose on a VM** | Extend `docker-compose.yml` with an `api` service (`dotnet PostIt.Api.dll` from a built image) + the existing `postgres` service + an nginx/Caddy/Traefik front container | Simplest self-hosted setup; data in the `postgres_data` volume, TLS at the reverse proxy. |
| **Kubernetes** | Same image as above; Deployment + Service + Ingress, Postgres managed or via an operator, secrets from a Secret store | Needs a SignalR scale-out strategy (sticky sessions or Redis backplane) before running more than one replica. |
| **Bare VM / IIS (Windows)** | Copy `./publish`, run under a systemd unit / Windows service / IIS application pool; `dotnet PostIt.Api.dll` | Reverse proxy still recommended for TLS and websockets. |
| **Managed .NET hosts** (Azure App Service Windows/Linux, Elastic Beanstalk, …) | Deploy the publish output directly | Same env-var configuration applies. |

Database: prefer a managed PostgreSQL (Azure Database for PostgreSQL, AWS RDS,
Neon, Supabase, …) in production instead of the local container.

SignalR specifics:

- The client connects to `/hubs/board` with the JWT in the query string
  (`?access_token=`); the hosting/gateway **must proxy WebSockets** (and long
  polling as fallback) without buffering.
- With more than one API instance, configure sticky sessions (ARR affinity) or
  a SignalR Redis backplane.

TLS: the app calls `UseHttpsRedirection()`. Terminate TLS at the reverse proxy
and set the forwarded scheme correctly, otherwise redirects can loop.

### Frontend

| Option | How | Notes |
| ------ | --- | ----- |
| **Desktop installers (primary target)** | `npm run tauri build` → produces the platform bundles declared in `tauri.conf.json` (`targets: "all"`): `.msi`/`.exe` (NSIS) on Windows, `.dmg`/`.app` on macOS, `AppImage`/`.deb` on Linux | Built per OS (or via CI matrices with `tauri-apps/tauri-action`). Sign/notarize the bundles for distribution outside your own machine; the Tauri updater can distribute from a static release feed (e.g. GitHub Releases). |
| **Web SPA on static hosting** (Nginx, Netlify, S3 + CloudFront, …) | `npm run build` → serve `dist/` | The dev proxy is **not** part of the build: for a production web client you must route `/api` and `/hubs` to the API (same-origin reverse proxy, or make the base URL configurable), and allow the SPA's origin in backend CORS. Tauri-specific features are unavailable in this mode. |
| **Store distribution** (Microsoft Store, Mac App Store) | Same bundles + store signing requirements | Only relevant for public desktop releases. |

### Suggested production topology (self-hosted)

```text
Browser / desktop clients
        │  HTTPS + WSS
   nginx / Caddy / Traefik  ← TLS termination, forwards /api and /hubs
        │
   PostIt.Api (dotnet)  ←── env vars / secret manager
        │
   PostgreSQL 16 (managed or containerized volume)
```

### Production readiness checklist

Gaps that exist **today** in the codebase (also documented in
`apps/server/README.md` §9 and `AGENTS.md`):

- [ ] **CORS**: only the `LocalDevelopment` policy exists
      (`http://localhost:5173`, `http://localhost:3000`). A production origin
      must be added before deploying a real client.
- [ ] **SignalR authorization gap**: `BoardHub.JoinBoard` only checks that the
      caller is authenticated, not that they are a board member.
- [ ] **Rate limiting**: the client IP comes from the direct connection and
      `X-Forwarded-For` is not trusted — configure explicit trusted proxies
      behind a load balancer, or all users share one bucket.
- [ ] **Secrets**: `JwtSettings__Secret` and the connection string must come
      from the platform's secret manager; never commit real values.
- [ ] **No `Dockerfile`/CI pipeline yet** for the API or the desktop bundles —
      decide a hosting model first, then add the build definition.
- [ ] **Health checks**: use `GET /health` (includes the PostgreSQL check) for
      load-balancer probes.

---

## Known limitations

- **Note content limit mismatch**: the application validates ≤ 1000 chars, the
  EF configuration allows 2000 (backend is authoritative at the app layer).
- **`BoardHub.JoinBoard`** does not verify board membership (auth only).
- **CORS** allows local development origins only.
- The repo currently has no CI/CD pipelines or production `Dockerfile`s — see
  the deployment section above.

## License

Not specified yet.
