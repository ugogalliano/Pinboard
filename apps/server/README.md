# PostIt Server

Backend API for the PostIt board application. ASP.NET Core Web API on **.NET 8**
following **Clean Architecture** (Domain / Application / Infrastructure / Api),
with **EF Core 8 + PostgreSQL**, **JWT** auth and **SignalR** realtime updates.

For the detailed design (layers, domain model, flows, authorization matrix) see
[`ARCHITECTURE.md`](./ARCHITECTURE.md). For agent/contributor conventions see
[`AGENTS.md`](./AGENTS.md).

---

## 1. Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Docker](https://www.docker.com/) — to run PostgreSQL locally
- EF Core CLI tool (only needed for migrations):

  ```bash
  dotnet tool install --global dotnet-ef
  ```

---

## 2. Project layout

```
apps/server/
├── PostIt.sln
├── Directory.Build.props      # net8.0, Nullable, ImplicitUsings, LangVersion 12
├── docker-compose.yml         # local PostgreSQL 16
├── src/
│   ├── PostIt.Domain/         # Entities + enums only (no EF/ASP.NET)
│   ├── PostIt.Application/    # Use cases, DTOs, interfaces, validation
│   ├── PostIt.Infrastructure/ # EF Core, repositories, JWT, password hashing
│   └── PostIt.Api/            # Controllers, SignalR hub, middleware, composition root
│       └── Migrations/        # EF migrations live here (MigrationsAssembly = PostIt.Api)
└── tests/
    ├── PostIt.UnitTests/         # xUnit + Moq
    └── PostIt.IntegrationTests/  # WebApplicationFactory + Testcontainers (SQLite fallback)
```

Dependencies point inward only: `Api → Application/Domain` and
`Infrastructure → Application/Domain`. Nothing in `Application`/`Domain` may
reference EF Core or `HttpContext`.

---

## 3. Configuration

Configuration comes from layered `appsettings*.json` files plus environment
variables and command-line args (standard ASP.NET Core configuration). Later
sources override earlier ones; **environment variables always win**, which is how
production secrets are injected.

| File | Purpose | Contains secrets? |
| ---- | ------- | ----------------- |
| `src/PostIt.Api/appsettings.json` | Base config for **all** environments | No |
| `src/PostIt.Api/appsettings.Development.json` | Dev-only overrides (local DB + JWT dev secret) | Dev values only |
| `src/PostIt.Api/appsettings.example.json` | Template to copy for your own environment | Placeholders |

### Configuration keys

| Key | Description | Required |
| --- | ----------- | -------- |
| `ConnectionStrings:DefaultConnection` | PostgreSQL connection string | Yes |
| `JwtSettings:Secret` | HMAC-SHA256 signing key, **≥ 32 chars** | Yes |
| `JwtSettings:Issuer` | JWT issuer (defaults to `PostIt`) | No |
| `JwtSettings:Audience` | JWT audience (defaults to `PostIt`) | No |

If `JwtSettings:Secret` is missing or too short at startup, the app throws. The
base `appsettings.json` intentionally ships **without** connection strings or JWT
settings — those must be supplied per environment.

### Overriding via environment variables

Nested keys use `__` (double underscore) as separator:

```bash
ConnectionStrings__DefaultConnection="Host=db;Database=postit;Username=postit;Password=..."
JwtSettings__Secret="<at-least-32-characters-secret>"
JwtSettings__Issuer="PostIt"
JwtSettings__Audience="PostIt"
ASPNETCORE_ENVIRONMENT="Production"
```

---

## 4. Development

### 4.1 Start PostgreSQL

```bash
cd apps/server
docker compose up -d
```

This starts `postgres:16-alpine` on `localhost:5432` with database/user/password
`postit` (override via the `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
env vars). Data persists in the `postgres_data` volume.

### 4.2 Apply migrations

```bash
cd apps/server/src/PostIt.Api
dotnet ef database update
```

### 4.3 Run the API

```bash
cd apps/server/src/PostIt.Api
dotnet run
```

`appsettings.Development.json` is applied automatically when the
`http`/`https` launch profiles are used (`ASPNETCORE_ENVIRONMENT=Development`).

| Profile | URL |
| ------- | --- |
| `http` | `http://localhost:5180` |
| `https` | `https://localhost:7113` and `http://localhost:5180` |

Swagger UI is only enabled in Development, at **`/swagger`**.

To force a specific profile:

```bash
dotnet run --launch-profile https
```

---

## 5. Tests

```bash
cd apps/server
dotnet test
```

- **Unit tests** (`PostIt.UnitTests`) — no external dependencies.
- **Integration tests** (`PostIt.IntegrationTests`) — use Testcontainers
  PostgreSQL when Docker is available, otherwise fall back to SQLite
  automatically. They run the real HTTP pipeline via `WebApplicationFactory`,
  in Development by default (where rate limiting is disabled); dedicated
  tests also exercise production rate limits.

---

## 6. Migrations

The **Api** project is the migrations assembly, so both `--project` and
`--startup-project` point at `src/PostIt.Api` (run from `apps/server`):

```bash
# Add a migration (after changing entities / EF configurations)
dotnet ef migrations add <Name> --project src/PostIt.Api --startup-project src/PostIt.Api

# Apply pending migrations
dotnet ef database update --project src/PostIt.Api --startup-project src/PostIt.Api
```

Any model change (entity, EF configuration, DbContext) requires a new checked-in
migration. Never hand-edit the schema.

---

## 7. Production

### 7.1 Publish

```bash
cd apps/server
dotnet publish src/PostIt.Api/PostIt.Api.csproj -c Release -o ./publish
```

### 7.2 Provide configuration via environment variables

Production settings come from the environment (the base `appsettings.json` has
no secrets). Set at minimum:

```bash
ASPNETCORE_ENVIRONMENT="Production"
ASPNETCORE_URLS="http://0.0.0.0:8080"
ConnectionStrings__DefaultConnection="Host=db;Port=5432;Database=postit;Username=...;Password=..."
JwtSettings__Secret="<at-least-32-characters-secret>"
```

### 7.3 Run

```bash
dotnet PostIt.Api.dll
```

Notes for production:

- **HTTPS**: the app calls `UseHttpsRedirection()`. Terminate TLS at your
  reverse proxy / load balancer (or configure Kestrel certs) and make sure the
  forwarded scheme is set correctly, otherwise redirects may loop.
- **Database**: apply migrations as a deploy step (`dotnet ef database update`
  or an equivalent SQL migration job) before starting the API.
- **Secrets**: never commit real connection strings or JWT secrets. Use the
  platform's secret manager / env vars.
- **CORS**: see the limitation in section 9 — the origin list is currently
  hardcoded for local development.

---

## 8. API endpoint overview

### Authentication

| Method | Endpoint | Description | Auth |
| ------ | -------- | ----------- | ---- |
| POST | `/api/auth/register` | Register a new account | No |
| POST | `/api/auth/login` | Login and receive tokens | No |
| POST | `/api/auth/refresh` | Refresh access token | No |
| POST | `/api/auth/logout` | Revoke refresh token | No |
| GET | `/api/auth/me` | Get current user profile | Bearer |

### Boards

| Method | Endpoint | Description | Auth |
| ------ | -------- | ----------- | ---- |
| GET | `/api/boards` | List boards for current user | Bearer |
| POST | `/api/boards` | Create a new board | Bearer |
| GET | `/api/boards/{boardId}` | Get a specific board | Bearer |
| PUT | `/api/boards/{boardId}` | Update board name | Bearer |
| DELETE | `/api/boards/{boardId}` | Delete a board | Bearer |

### Board Members

| Method | Endpoint | Description | Auth |
| ------ | -------- | ----------- | ---- |
| GET | `/api/boards/{boardId}/members` | List board members | Owner |
| POST | `/api/boards/{boardId}/members` | Add a member | Owner |
| PUT | `/api/boards/{boardId}/members/{memberUserId}` | Update member role | Owner |
| DELETE | `/api/boards/{boardId}/members/{memberUserId}` | Remove a member | Owner |

### Notes

| Method | Endpoint | Description | Auth |
| ------ | -------- | ----------- | ---- |
| GET | `/api/boards/{boardId}/notes` | List notes on a board | Member |
| POST | `/api/boards/{boardId}/notes` | Create a note | Editor |
| PUT | `/api/notes/{noteId}` | Update a note | Editor |
| DELETE | `/api/notes/{noteId}` | Delete a note | Editor |

### Health & diagnostics

| Method | Endpoint | Description | Auth |
| ------ | -------- | ----------- | ---- |
| GET | `/health` | Health check (includes DB connectivity) | No |
| GET | `/api/ping` | Liveness ping | No |

### SignalR

| Path | Description | Auth |
| ---- | ----------- | ---- |
| `/hubs/board` | Realtime board updates | Bearer (via `?access_token=`, `/hubs` only) |

Errors use RFC 7807 `application/problem+json`. Postgresql health is exposed as
the `postgresql` check in `/health`.

---

## 9. Operations & known limitations

- **Rate limiting**: disabled in Development. In other environments, login and
  registration share a **10 requests / minute per IP** bucket; refresh has a
  separate bucket with the same limit. `/me` and logout are not limited.
  `DisableRateLimiting` does not disable limits in Production. The client IP is
  taken from the direct connection; `X-Forwarded-For` is not trusted. If a
  reverse proxy is used, configure explicit trusted proxy addresses before
  adding forwarded-header handling, or clients may share the proxy IP bucket.
- **CORS**: only the `LocalDevelopment` policy exists, allowing
  `http://localhost:5173` and `http://localhost:3000`. A production frontend
  origin is **not** allowed yet — this must be extended before deploying a real
  client.
- **JWT**: 15-minute access tokens (HMAC-SHA256); refresh tokens are 32 random
  bytes, 7-day expiry, **rotated on every use**, and revoked on logout. Claims:
  `sub`, `email`, `jti`. `ClockSkew` is zero.
- **Known authz gap**: `BoardHub.JoinBoard` adds a connection to the board group
  without verifying the caller is a board member (authentication only). Treat
  membership verification as an open requirement.
- **Logging**: structured single-line console output with UTC timestamps;
  sensitive data (passwords, tokens, headers, note content) is never logged.
- **Migrations location**: EF migrations live in `src/PostIt.Api/Migrations`
  (the Api project is the migrations assembly). `ARCHITECTURE.md` shows an
  outdated path — trust the code and this README.
