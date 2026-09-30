# AGENTS.md — PostIt Server

Practical guide for any agent working on `apps/server`. Read `ARCHITECTURE.md`
and `../../docs/PLAN.BE.md` for the fuller design story; this file is the
operative reference: conventions, patterns, commands, and the Definition of
Done.

## 1. Structure and architecture

The server is a **.NET 8** solution (`PostIt.sln`) following **Clean
Architecture**. Four source projects plus two test projects; dependencies point
inward only:

```
apps/server/
├── PostIt.sln
├── Directory.Build.props          # net8.0, Nullable, ImplicitUsings, LangVersion 12, analyzers
├── .editorconfig                  # 4-space indent, CRLF, System directives first
├── docker-compose.yml             # local PostgreSQL 16
├── README.md / ARCHITECTURE.md
├── src/
│   ├── PostIt.Api/                # Presentation: controllers, SignalR hub, middleware, Program.cs
│   │   ├── Controllers/           #   AuthController, BoardsController, NotesController
│   │   ├── Hubs/BoardHub.cs
│   │   ├── Middleware/ExceptionHandlingMiddleware.cs
│   │   ├── Services/BoardNotificationService.cs
│   │   └── Migrations/            # EF Core migrations live HERE (MigrationsAssembly = "PostIt.Api")
│   ├── PostIt.Application/        # Use cases: services, DTOs, interfaces, validation
│   │   ├── DTOs/                  #   positional records (request/response)
│   │   ├── Interfaces/            #   I*Service, I*Repository, IPasswordHasher, ITokenService
│   │   ├── Services/              #   AuthService, BoardService, BoardMemberService,
│   │   │                          #   BoardAuthorizationService, NoteService
│   │   └── DependencyInjection.cs #   AddApplication()
│   ├── PostIt.Domain/             # Core domain: entities, enums. NO ASP.NET/EF references.
│   │   ├── Entities/              #   User, Board, BoardMember, Note, RefreshToken
│   │   └── Enums/BoardRole.cs     #   Owner, Editor, Viewer
│   └── PostIt.Infrastructure/     # Data/ports: EF Core, repositories, JWT, password hashing
│       ├── Authentication/        #   JwtTokenService, PasswordHasher (Identity PBKDF2)
│       ├── Persistence/           #   PostItDbContext, Configurations/, Repositories/
│       └── DependencyInjection.cs #   AddInfrastructure(IConfiguration)
└── tests/
    ├── PostIt.UnitTests/          # xUnit + Moq
    └── PostIt.IntegrationTests/   # WebApplicationFactory + Testcontainers (SQLite fallback)
```

Dependency rule (never violate):

- `PostIt.Domain` — entities and enums only; **no ASP.NET, no EF Core, no `Microsoft.EntityFrameworkCore` imports**.
- `PostIt.Application` — orchestrates use cases against **interfaces**; contains DTOs, validation, exception mapping. **No EF Core, no `HttpContext`** (tells you a layer boundary broke if you see those here).
- `PostIt.Infrastructure` — implements the interfaces (`I*Repository`, `IPasswordHasher`, `ITokenService`) with EF Core / Npgsql / JWT. References Application + Domain.
- `PostIt.Api` — composition root. `Program.cs` calls `AddApplication()` and `AddInfrastructure(configuration)`. Owns controllers, hub, middleware, JWT/auth wiring, CORS, rate limiting, health checks.

Key mechanics:

- **DI**: constructor injection everywhere. Application services are registered
  Scoped in `AddApplication()`; DbContext, repositories and auth services in
  `AddInfrastructure()`. `IBoardNotificationService` is Api-side (it wraps
  `IHubContext`) and is registered in `Program.cs`.
- **Unit of work**: repositories track entities on the shared Scoped
  `PostItDbContext`; **services call `SaveChangesAsync` once per use case** so
  multi-entity writes (e.g. board + owner member) commit in a single
  transaction. Exceptions to the rule: `AuthService` and
  `RefreshTokenRepository` save inside the repository (`RefreshTokenRepository.AddAsync`
  calls `SaveChangesAsync` itself). Follow the dominant "save once in the
  service" pattern for new code.
- **Realtime**: after a successful mutation the service calls
  `IBoardNotificationService.PostIt*` to broadcast over SignalR. Broadcast
  **only after** `SaveChangesAsync` succeeds — never before persistence.

## 2. Coding conventions and naming

Enforced/documented by `Directory.Build.props`, `.editorconfig`, and codebase
consistency:

- **Formatting**: 4-space indentation, CRLF, UTF-8, final newline, trailing
  whitespace trimmed, `System.*` directives first, Allman braces (`{` on a new
  line). Run `dotnet format` to normalize.
- **Language settings**: `net8.0`, `<Nullable>enable</Nullable>`,
  `<ImplicitUsings>enable</ImplicitUsings>`, `LangVersion 12`, analyzer level
  `latest` (warnings are NOT treated as errors). Do not add new analyzer
  warnings.
- **Namespaces**: file-scoped, `PostIt.<Layer>[.<Sub>]`, matching the folder
  (e.g. `PostIt.Infrastructure.Persistence.Configurations`).
- **Naming**: `PascalCase` types/methods, `_camelCase` private fields,
  `camelCase` locals/params. Async methods suffixed `Async`; repository/svc
  methods take a trailing `CancellationToken cancellationToken = default`.
- **Entities** (`PostIt.Domain/Entities`): rich domain models —
  - `private set` on all properties;
  - public constructor sets `Id = Guid.NewGuid()` and `DateTime.UtcNow` timestamps;
  - behavior through methods (`UpdateName`, `UpdateContent`, `UpdatePosition`, `Revoke`, `UpdateRole`);
  - a private parameterless constructor exists only for EF Core materialization;
  - navigation properties use `= null!` (e.g. `public User Creator { get; private set; } = null!;`).
- **DTOs** (`PostIt.Application/DTOs`): immutable positional `record`s with XML
  doc comments on the primary constructor parameters. Request DTOs use the
  `*Request` suffix, responses `*Response`/`*Dto`.
- **XML docs**: enabled in `PostIt.Api` for Swagger (`GenerateDocumentationFile`
  - `NoWarn 1591`). Keep summary comments on DTOs; public API surface benefits
    from them.

## 3. Patterns to follow / avoid

### Follow

- **Thin controllers**: parse the user id, delegate to a service, map exceptions
  to status codes. No business logic, no EF, no SQL in controllers.
- **Service-per-use-case**: one `I*Service`/`*Service` pair per aggregate
  (`Auth`, `Board`, `BoardMember`, `Note`) plus `BoardAuthorizationService` for
  permission checks.
- **Repository pattern**: interface in `PostIt.Application/Interfaces`,
  EF implementation in `PostIt.Infrastructure/Persistence/Repositories`.
  Reads that return collections use `.AsNoTracking()`; writes use the tracked
  entity and a final `SaveChangesAsync`.
- **Manual mapping**: private `static XDto MapToDto(Entity e)` in the service;
  lists via `.Select(MapToDto).ToList()`. No AutoMapper in this codebase.
- **Exception → status mapping** in controllers (see section 4).
- **DI extension methods**: register a layer's services in its own
  `DependencyInjection.cs` and call it from `Program.cs`.
- **Cancellation**: thread `CancellationToken` through service and repository
  calls.
- **Current user**: reuse the `GetCurrentUserId()` private helper pattern
  (`User.FindFirst(ClaimTypes.NameIdentifier) ?? User.FindFirst("sub")`, then
  `Guid.TryParse`).

### Avoid

- EF types / `HttpContext` in `Application` or `Domain`.
- Returning entities to the client — always map to DTOs (never leak
  `PasswordHash`).
- Business rules in controllers or repositories.
- Soft deletes / audit/trash features — the MVP contract is **hard deletes**
  (`../../docs/PLAN.BE.md` §3).
- AutoMapper or other new libraries without a stated need (see Definition of
  Done: no new dependencies without justification).
- Leaving dead code behind.

## 4. API, validation and error handling

Endpoints (all JSON; auth endpoints rate-limited — see section 7):

```
POST /api/auth/register        POST /api/auth/login
POST /api/auth/refresh         POST /api/auth/logout
GET  /api/auth/me              [Authorize]

GET/POST /api/boards           [Authorize]
GET/PUT/DELETE /api/boards/{boardId:guid}            [Authorize]
GET/POST /api/boards/{boardId:guid}/members          [Owner]
PUT/DELETE /api/boards/{boardId:guid}/members/{memberUserId:guid}  [Owner]
GET/POST /api/boards/{boardId:guid}/notes            [member/editor]
PUT/DELETE /api/notes/{noteId:guid}                  [editor]

GET /health                    # health check incl. DB connectivity
GET /api/ping                  # liveness, no auth
/hubs/board                    # SignalR hub (JWT via ?access_token=)
```

Conventions:

- Controllers use `[ApiController]`, `[Route("api/...")]`, `[Authorize]`
  (class-level for protected controllers), `[Http*]` verbs with `:guid` route
  constraints, and `[ProducesResponseType]` for the Swagger contract.
- Success: `Ok(dto)` (200), `NoContent()` (204) for deletes/logout.
- Errors use `Problem(...)` → `application/problem+json` (RFC 7807), with a
  stable mapping:

| Service throws                | Status  | Meaning                        |
| ----------------------------- | ------- | ------------------------------ |
| `KeyNotFoundException`        | 404     | resource does not exist        |
| `UnauthorizedAccessException` | 403     | authenticated but not allowed  |
| `ArgumentException`           | 400     | invalid input (message shown)  |
| `InvalidOperationException`   | 401/409 | e.g. auth failure / duplicates |

Exceptions are caught **in the controller**, per endpoint, and translated to
`Problem(...)` — the services never return HTTP concerns. Anything that
escapes is caught by `ExceptionHandlingMiddleware` → 500
`application/problem+json` (detail hidden outside Development).

- **Validation lives in the service layer** as private static
  `Validate*(...)` helpers throwing `ArgumentException` (e.g.
  `NoteService.ValidateContent`/`ValidateColor`, `BoardService.ValidateName`).
  Keep this style for new validations.
- Current limits (align with the app-level checks, note the DB mismatch):
  - Note `Content`: required, ≤ **1000** chars (app) — but the EF
    `NoteConfiguration` allows **2000**. `Color`: required, ≤ 50.
  - Board `Name`: required, ≤ 200.
  - Member roles via `Enum.TryParse<BoardRole>`; `Owner` is not assignable by
    clients; removing the last Owner is rejected.

## 5. Database / ORM and migrations

- **EF Core 8 + Npgsql + PostgreSQL 16** (local via `docker compose up -d`).
- **DbContext**: `PostIt.Infrastructure/Persistence/PostItDbContext.cs` — one
  `DbSet` per entity, default schema `public`, applies every
  `IEntityTypeConfiguration` from its assembly automatically.
- **Schema mapping**: one `*Configuration` class per entity under
  `Persistence/Configurations/` using the Fluent API — table name, keys,
  `IsRequired()`, `HasMaxLength()`, indexes, relationships, `OnDelete` behavior.
  Important current rules:
  - `Users.Email` unique index;
  - `BoardMembers` unique index on `(BoardId, UserId)`, `Role` stored as string,
    Cascade on user/board delete;
  - `Notes` index on `BoardId`, Cascade from board, **SetNull** on creator delete;
  - `RefreshTokens.Token` unique index.
- **Migrations**: stored in **`src/PostIt.Api/Migrations/`** (the Api project is
  the migrations assembly — `MigrationsAssembly("PostIt.Api")` is set in
  `AddInfrastructure`). `ARCHITECTURE.md` shows an outdated location; trust the
  code. Three migrations exist (`Initial`, `AddDatabaseModel`,
  `AddRefreshTokens`).

Commands (run from `apps/server` unless noted):

```bash
dotnet build                                    # build the whole solution
dotnet test                                     # run all tests (see section 6)
docker compose up -d                            # start local PostgreSQL
dotnet ef migrations add <Name> --project src/PostIt.Api --startup-project src/PostIt.Api
dotnet ef database update --project src/PostIt.Api --startup-project src/PostIt.Api
cd src/PostIt.Api && dotnet run                 # run the API (Dev → Swagger at /swagger)
dotnet format                                   # enforce .editorconfig formatting
```

> Note: the codebase is **not currently `dotnet format`-clean** — pre-existing
> violations exist (e.g. charset on the migration files, using-order in
> `PostItDbContext.cs`). Run `dotnet format` scoped to files you touched, or
> accept that a full run produces unrelated churn. Do not use format-clean as a
> hard gate; the Definition of Done gates on `dotnet build` + `dotnet test`
> passing with no _new_ warnings.

Rules: any model change (entity, configuration, DbContext) **requires a new
migration** checked into the repo. Do not hand-edit schema; regenerate
migrations with `dotnet ef migrations add`. Never commit secrets or production
connection strings in config.

## 6. Testing and verification

Two projects, both xUnit.

- **Unit tests** (`tests/PostIt.UnitTests`) — `Moq` mocks of the Application
  interfaces (e.g. `NoteServiceTests` mocks `INoteRepository`,
  `IBoardAuthorizationService`, ...). Cover domain entities, service logic,
  validation, authz, password hashing and JWT. No external dependencies; set
  entity ids via reflection when needed
  (`typeof(Board).GetProperty("Id")!.SetValue(board, boardId)`).
- **Integration tests** (`tests/PostIt.IntegrationTests`) — share
  `TestWebApplicationFactory : WebApplicationFactory<Program>` (`IClassFixture`)
  which:
  - overrides config in-memory (`ConnectionStrings`, `JwtSettings`,
    `DisableRateLimiting=true`);
  - uses **Testcontainers PostgreSQL** when Docker is available, otherwise
    **falls back to SQLite** (`EnsureCreated`);
  - exercises real HTTP endpoints (register → login → boards → notes → SignalR)
    and asserts on DTOs + status codes.
  - Helpers: each test class defines a private `RegisterAndLoginAsync` /
    `CreateBoardAsync` (keep this per-class convention or centralize when it
    grows).

Verification commands (the Definition of Done gates):

```bash
dotnet build
dotnet test
```

Run both from `apps/server` and confirm **all pass** before claiming work is
done. Integration tests run without Docker thanks to the SQLite fallback;
prefer validating against the real Postgres path when Docker is available.

## 7. Security and secrets

- **JWT**: HMAC-SHA256, 15-minute access tokens; `JwtSettings:Secret` must be
  ≥ 32 chars and is read from configuration at startup (app throws if missing).
  `Issuer`/`Audience` default to `PostIt`. `ClockSkew = TimeSpan.Zero`.
  Claims: `sub` (user id), `email`, `jti`.
- **Refresh tokens**: 32 random bytes via `RandomNumberGenerator`, persisted,
  7-day expiry, **rotated on every use** (old revoked, `ReplacedByToken`
  recorded), revoked on logout.
- **Passwords**: ASP.NET Core Identity `PasswordHasher<User>` (PBKDF2 + salt).
  Never implement custom hashing.
- **Rate limiting**: `"auth"` policy — 5 requests/minute per IP on
  `AuthController`. Globally disabled via config flag `DisableRateLimiting`
  (used by the test factory).
- **Secrets**: dev-only values live in `appsettings.Development.json` (default
  Postgres creds, dev JWT secret). Production values must come from environment
  variables / config providers — never commit real secrets.
- **SignalR**: hub is `[Authorize]`; JWT is accepted from the query string
  (`?access_token=...`) but only for paths under `/hubs`.
- **CORS**: `LocalDevelopment` policy only — `http://localhost:5173` and
  `http://localhost:3000`.
- **Known gap** (do not silently rely on): `BoardHub.JoinBoard` adds a
  connection to the group without verifying the caller is a board member —
  only authentication is enforced. If you work on the hub, treat membership
  verification as an open requirement and flag it rather than assuming it.
- Never log tokens, passwords, or `PasswordHash`.

## 8. Performance and observability

- Use `.AsNoTracking()` on read-only queries (repository pattern already does).
- Indexes are defined in the EF configurations for the hot paths
  (`Notes.BoardId`, `BoardMembers(BoardId, UserId)`); add indexes with schema
  changes that introduce new query patterns.
- Health: `GET /health` (includes a `postgresql` DB check), `GET /api/ping`.
- Logging: console structured logging; HTTP request logging enabled in
  Development only. `ExceptionHandlingMiddleware` logs unhandled exceptions
  with method + path.
- Thread `CancellationToken` so aborted requests don't waste DB work.

### Logging

The server follows a structured logging standard (no requestId/correlation — operations are self-contained and identifiable by their entity GUIDs).

- **Levels**:
  - `INFO` — significant flow milestones: `Validation completed`, `<Entity> created/updated/deleted`, auth successes, `Broadcast sent`, `Hub joined/left`.
  - `WARNING` — abnormal but manageable situations: `Login failed`, `Refresh failed`, `Authorization denied`. Never for normal operation.
  - `ERROR` — operation failures that need attention; always logged with the exception. Never for expected 4xx client errors (validation, not-found, forbidden) or request cancellations (`OperationCanceledException` is rethrown without a log).
- **Format**: structured `ILogger` messages with `{Placeholder}` arguments (never string interpolation), one event per line: `EventName | key={Value}`. Milestone events may be bare (no key=value), e.g. `Validation completed`. The logger category is the component. Console output is single-line with a UTC timestamp (configured in `Program.cs` via `AddSimpleConsole`: `SingleLine`, `TimestampFormat`, `UseUtcTimestamp`).
- **Event naming**: stable `PascalCase` event phrases as the first token (`Note created`, `Login failed`, `Broadcast sent`, `Hub joined`), then `key=value` pairs. Reuse the existing vocabulary rather than inventing synonyms.
- **What to log**: only meaningful phases — validation completed, entity persisted (after the single `SaveChangesAsync` in the service, never in repositories), auth outcomes, SignalR broadcasts, hub join/leave, authorization denials (`WARNING`). Reads are NOT logged. Repositories are NOT logged.
- **External calls (SignalR broadcast)**: `INFO Broadcast sent | boardId=... event=... durationMs=...` on success; `ERROR Broadcast failed` with exception on failure (rethrow the original exception); `OperationCanceledException` (client abort) is rethrown WITHOUT logging — it is normal in realtime apps.
- **Durations**: record `durationMs` on significant operations (e.g. broadcast). There is no request-level timing.
- **Sensitive data — never log**: passwords, `PasswordHash`, access/refresh tokens, `Authorization` headers, query strings (SignalR `?access_token=`), request/response bodies, user content (note content/color, board names), emails by default, configuration secrets (JWT signing key, connection strings), IP addresses. Log GUID IDs only.
- **ERROR context**: operation, component (logger category), entity IDs, exception and message. Never generic messages like "Something went wrong".
- **Logging review criteria** (enforced by the reviewer agent, see `.opencode/agents/reviewer-server.md`):
  1. New significant flows include the necessary logs; start and end of significant operations are traceable at operation level.
  2. `INFO`/`WARNING`/`ERROR` are used correctly — no `ERROR` for normal operation, no `WARNING` misuse.
  3. `ERROR` logs exist wherever an operation can fail, with sufficient troubleshooting context (operation, component, entity ID, exception).
  4. No duplicated or unnecessarily verbose logs; logging is meaningful, never per-statement.
  5. External calls (SignalR broadcasts) are traced: event, `durationMs`, failure `ERROR`.
  6. Durations are recorded where needed to diagnose performance problems.
  7. No sensitive data is ever logged.
  8. New logs follow the event-naming and format conventions above.
  9. When a log is missing, the reviewer must state where, which event, which level, what information, and why it helps troubleshooting.

## 9. Sub-agent workflow

Dispatch specialized sub-agents for non-trivial work. Not every agent is
required on every task — use the _when to use_ guidance.

| Agent                    | When to use                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **architect**            | Major features, new subsystems, changes that alter how components fit or change interfaces others depend on. Runs **before** code is written. |
| **implementer**          | Default choice for writing code once the approach is decided.                                                                                 |
| **tester**               | When new behavior needs tests, or a change carries regression risk.                                                                           |
| **reviewer**             | Always after implementation and before considering a task done; required for anything non-trivial.                                            |
| **security-reviewer**    | Any change touching auth, JWT, rate limiting, CORS, input validation, secrets, or the SignalR hub.                                            |
| **db-reviewer**          | Any change to schema, EF configurations, migrations, repositories or queries.                                                                 |
| **performance-reviewer** | Performance-critical changes: hot query paths, list endpoints, realtime broadcast, N+1 risks, indexing.                                       |

Workflow:

```
Architect → Implement → Test → Review → Security/DB/Performance Review
    → Fix → Re-test → Re-review
```

- Only run the review stages relevant to the change (e.g. a schema change needs
  **db-reviewer**; an auth change needs **security-reviewer**; a tiny DTO tweak
  may only need **reviewer**).
- A fix must be followed by re-running the failing tests and re-review.
- All agents must obey the working rules in section 10.

## 10. Agent working rules (mandatory)

- **Read the code before modifying it.** Understand the surrounding file,
  its imports, and how neighbors do the same thing.
- **Reuse existing patterns** (exception mapping, repository style, DTO
  records, DI registration) rather than inventing parallel ones.
- **Keep the diff minimal.** Touch only what the task requires.
- **No refactoring unless requested.** If the code you must change has
  problems, mention them and propose targeted fixes — don't silently
  restructure.
- **Never ignore failing tests / lint / typecheck.** A red build is a blocker,
  not a footnote.
- **Do not add dependencies without a reason.** If a new package seems
  necessary, call it out explicitly with the rationale.
- **Flag conflicts and ambiguity** instead of inventing solutions. If
  requirements or code contradict each other (e.g. the authz gap in
  `BoardHub`, or doc-vs-code drift), say so.

## 11. Definition of Done

A task on `apps/server` is done only when all of these hold:

- [ ] `dotnet build` succeeds with no **new** analyzer warnings.
- [ ] `dotnet test` passes (unit + integration) for the whole solution.
- [ ] New behavior has tests covering success and failure paths.
- [ ] Follows the conventions and patterns in sections 2–4 (no new patterns
      invented, no EF/ASP.NET leakage into Application/Domain).
- [ ] Returns DTOs, not entities; errors use the documented exception → status
      mapping.
- [ ] New logging (if any) follows the Logging standard in §8 (levels, format, event names, no sensitive data).
- [ ] Schema/model changes include a checked-in EF migration.
- [ ] No secrets or real credentials committed; dev values only in
      Development config.
- [ ] No new dependencies without stated justification.
- [ ] Diff is minimal; no unrequested refactors.
- [ ] `ARCHITECTURE.md` / `README.md` updated if the change makes them stale
      (or the drift is flagged).

