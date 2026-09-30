# PLAN.BE.md

# PostIt Server — Backend Plan

## 0. Scope and execution rule

This is the **first implementation plan**.

The backend should be built incrementally, with each phase producing a runnable and testable result.

Target stack:

- C#
- ASP.NET Core Web API
- SignalR
- PostgreSQL
- Entity Framework Core
- ASP.NET Core Identity/password hashing
- JWT access tokens
- Refresh tokens
- Swagger/OpenAPI
- xUnit
- Testcontainers or equivalent PostgreSQL integration-test strategy

---

## 1. Monorepo structure

Recommended structure:

```text
postit/
├── apps/
│   ├── desktop/
│   │   └── ... React + Tauri ...
│   │
│   └── server/
│       ├── src/
│       │   ├── PostIt.Api/
│       │   ├── PostIt.Application/
│       │   ├── PostIt.Domain/
│       │   └── PostIt.Infrastructure/
│       │
│       └── tests/
│           ├── PostIt.UnitTests/
│           └── PostIt.IntegrationTests/
│
├── packages/
│   └── shared/
│
├── docker-compose.yml
├── README.md
└── ...
```

The backend remains completely independent from the React/Tauri UI.

---

## 2. Backend architecture

Use a clean separation:

```text
PostIt.Api
    ↓
PostIt.Application
    ↓
PostIt.Domain

PostIt.Infrastructure
    ↓
PostgreSQL
```

Application services / use cases own transaction boundaries. Use EF Core `SaveChangesAsync` as the unit-of-work commit inside each use case.

### PostIt.Domain

Contains:

- entities;
- value objects where useful;
- domain rules;
- enums;
- domain exceptions.

No ASP.NET-specific code.

### PostIt.Application

Contains:

- use cases;
- DTOs;
- interfaces;
- validation;
- application services;
- authorization policies where appropriate.

### PostIt.Infrastructure

Contains:

- EF Core;
- PostgreSQL;
- repositories/data access;
- Identity implementation;
- token persistence;
- external infrastructure.

### PostIt.Api

Contains:

- controllers;
- SignalR hubs;
- authentication configuration;
- middleware;
- dependency injection;
- Swagger;
- HTTP concerns.

---

## 3. Domain model — MVP

Start with only the entities required for the first working product.

### User

```text
Id
Email
PasswordHash
DisplayName
CreatedAt
UpdatedAt
```

If ASP.NET Core Identity is used, prefer its user model instead of creating a parallel password system. If Identity is adopted, keep the `User` aggregate in `PostIt.Domain` free from ASP.NET-specific types; map between Identity entities and domain entities in `PostIt.Infrastructure`.

### Board

```text
Id
Name
CreatedBy
CreatedAt
UpdatedAt
```

### BoardMember

```text
Id
BoardId
UserId
Role
CreatedAt
```

Roles:

```text
Owner
Editor
Viewer
```

### PostIt

```text
Id
BoardId
CreatedBy
Content
Color
PositionX
PositionY
CreatedAt
UpdatedAt
```

Keep the MVP data model small.

> **MVP delete policy:** hard deletes. No soft-delete flags. When a board or Post-it is deleted, it is removed permanently.  
> **User deletion:** prevent deleting a user who owns boards, or cascade-delete owned boards and their Post-its. Choose one behavior and enforce it at the database level.

---

## 4. Phase 1 — Backend solution skeleton

Create the .NET solution.

Tasks:

- create solution;
- create API project;
- create Domain project;
- create Application project;
- create Infrastructure project;
- create unit-test project;
- create integration-test project;
- configure project references;
- configure nullable reference types;
- configure analyzers;
- configure formatting;
- configure dependency injection;
- configure CORS for local frontend development;
- configure Swagger/OpenAPI.

Acceptance criteria:

```text
dotnet build
```

must succeed.

Tests must execute successfully even before database functionality is implemented.

Commit:

```text
chore: initialize backend solution
```

---

## 5. Phase 2 — Local PostgreSQL

Create local development infrastructure.

Use Docker Compose for PostgreSQL.

Example conceptual setup:

```text
PostIt API
    │
    ▼
PostgreSQL container
```

Tasks:

- PostgreSQL container;
- local database;
- credentials through environment variables;
- development connection string;
- EF Core DbContext;
- initial migration infrastructure;
- health check.

Do not hard-code production secrets.

Acceptance criteria:

- PostgreSQL starts locally;
- API connects to PostgreSQL;
- database health check succeeds;
- migration can be applied locally.

Commit:

```text
feat: add local postgres infrastructure
```

---

## 6. Phase 3 — Database model

Implement:

```text
User
Board
BoardMember
PostIt
```

Define:

- primary keys;
- foreign keys;
- indexes;
- unique constraints;
- cascade/delete behavior;
- timestamps;
- required fields;
- maximum lengths.

Important indexes and constraints should include:

```text
UNIQUE BoardMember(BoardId, UserId)
INDEX PostIt(BoardId)
```

Add EF Core migrations.

Consider adding seed data (e.g., a default local user and board) for easier manual testing during development.

Acceptance criteria:

- migration creates database schema;
- application can start against a clean database;
- integration test can create/read entities.

Commit:

```text
feat: add initial database model
```

---

## 7. Phase 4 — Authentication

Implement authentication before boards.

Required endpoints:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
```

### Registration

Input:

```text
email
password
displayName
```

Validate:

- valid email;
- password requirements;
- unique email;
- normalized email.

### Login

Return:

```text
accessToken
expiresAt
refreshToken
```

Do not return password information.

### Refresh

Refresh tokens should be:

- random;
- stored securely;
- revocable;
- associated with a user;
- expired;
- rotated on every use (new refresh token issued, old one invalidated).

### Rate limiting

Apply rate limiting to authentication endpoints to mitigate brute-force attacks. A simple in-memory limit is sufficient for MVP.

### Passwords

Use ASP.NET Core Identity's password hashing or another established secure password-hashing mechanism.

Never implement custom password hashing.

Acceptance criteria:

- registration works;
- duplicate email is rejected;
- login works;
- invalid password is rejected;
- authenticated endpoint recognizes the user;
- refresh works;
- logout invalidates the refresh token (access tokens remain valid until expiry).

Commit:

```text
feat: add authentication
```

---

## 8. Phase 5 — Authorization foundation

Define authorization rules before implementing board endpoints.

At minimum:

```text
Owner
Editor
Viewer
```

Rules:

### Owner

- read board;
- edit board;
- create/edit/delete Post-its;
- manage members.

### Editor

- read board;
- create/edit/delete Post-its.

### Viewer

- read board.

Authorization must be enforced server-side.

Never trust frontend role checks.

Acceptance criteria:

- unauthorized requests return correct HTTP status;
- user cannot access boards they do not belong to;
- Viewer cannot mutate board content;
- Editor cannot manage members;
- Owner can manage members.

Commit:

```text
feat: add board authorization policies
```

---

## 9. Phase 6 — Board API

Implement:

```text
GET  /api/boards
POST /api/boards

GET  /api/boards/{boardId}
PUT  /api/boards/{boardId}
DELETE /api/boards/{boardId}
```

When creating a board:

1. create board;
2. assign creator as Owner;
3. persist transactionally.

Return DTOs rather than EF Core entities.

Acceptance criteria:

- authenticated user can create board;
- creator automatically becomes Owner;
- board list contains only accessible boards;
- unauthorized board access is rejected.

Commit:

```text
feat: add board api
```

---

## 10. Phase 7 — Member management

Implement:

```text
GET  /api/boards/{boardId}/members
POST /api/boards/{boardId}/members
PUT  /api/boards/{boardId}/members/{userId}
DELETE /api/boards/{boardId}/members/{userId}
```

MVP invitation model can initially be simple:

```text
Owner selects existing user by email
        ↓
backend verifies user
        ↓
BoardMember created
```

Do not build email invitations until needed. This means users can only be added by email if they are already registered; returning 404 for unknown emails is acceptable in MVP.

Validation:

- owner cannot be accidentally removed;
- duplicate membership rejected;
- invalid role rejected;
- only authorized users can manage members.

Commit:

```text
feat: add board members
```

---

## 11. Phase 8 — Post-it API

Implement:

```text
GET    /api/boards/{boardId}/notes
POST   /api/boards/{boardId}/notes
PUT    /api/notes/{noteId}
DELETE /api/notes/{noteId}
```

Creation payload:

```text
content
color
positionX
positionY
```

Update payload should support changing:

```text
content
color
positionX
positionY
```

The backend remains the source of truth.

Validation:

- note belongs to board;
- user belongs to board;
- user has mutation permission;
- content length is bounded;
- color is valid;
- position values are valid.

Acceptance criteria:

- CRUD works;
- permissions work;
- data survives restart;
- API returns stable DTOs.

Commit:

```text
feat: add post-it api
```

---

## 12. Phase 9 — SignalR

Implement realtime collaboration only after REST persistence works.

Hub:

```text
/hubs/boards
```

Conceptual flow:

```text
Client
  │
  │ connect
  ▼
BoardHub
  │
  ├── authenticate
  └── join board group
```

Board group:

```text
board:{boardId}
```

Server events:

```text
PostItCreated
PostItUpdated
PostItDeleted
```

The exact payload should use DTOs shared with the API contract.

When an HTTP mutation succeeds:

```text
HTTP request
    ↓
validate
    ↓
persist
    ↓
broadcast SignalR event
```

Do not broadcast changes before persistence succeeds.

Authorization must also be checked when joining a board. In `OnConnectedAsync`, validate the user's JWT and verify board membership before calling `Groups.AddToGroupAsync`.

Acceptance criteria:

- authenticated user can connect;
- authorized user can join a board;
- unauthorized user cannot join;
- successful mutations broadcast;
- failed mutations do not broadcast.

Commit:

```text
feat: add realtime board collaboration
```

---

## 13. Phase 10 — API contract

Stabilize and complete the Swagger/OpenAPI contract. Basic Swagger UI should already be available from Phase 1.

Document:

- authentication;
- request DTOs;
- response DTOs;
- error responses;
- authorization requirements;
- SignalR hub URL;
- SignalR event payloads.

Frontend development should begin from this contract.

Generate or maintain typed frontend models from the agreed contract when practical.

The backend must not silently change response shapes after frontend implementation begins.

---

## 14. Error handling

Create a consistent API error format.

Prefer a standard problem-details style response.

Conceptually:

```json
{
  "type": "...",
  "title": "...",
  "status": 400,
  "detail": "...",
  "errors": {}
}
```

Map common cases consistently:

```text
400 validation
401 unauthenticated
403 forbidden
404 not found
409 conflict
500 unexpected server error
```

Do not expose stack traces or sensitive infrastructure information to clients.

---

## 15. Observability and diagnostics

For local development:

- structured logging;
- request logging where useful;
- health endpoint;
- database health check;
- clear startup errors.

Endpoints:

```text
GET /health
```

Potential future endpoint:

```text
GET /health/ready
```

Do not over-engineer observability in MVP.

---

## 16. Backend testing strategy

### Unit tests

Test:

- domain rules;
- validation;
- authorization logic;
- application services.

### Integration tests

Use Testcontainers for PostgreSQL integration tests. Verify it works in the local environment; if it proves unreliable, fall back to a dedicated test database with `EnsureDeleted`/`EnsureCreated`.

Test:

```text
register
login
refresh
create board
add member
create Post-it
update Post-it
delete Post-it
authorization
```

### API tests

At minimum:

```text
401 without authentication
403 without permission
404 for inaccessible resources where appropriate
400 invalid input
409 duplicate/conflicting resources
```

### Realtime tests

Verify:

```text
authorized client joins board
unauthorized client is rejected
mutation triggers event
failed mutation triggers no event
```

---

## 17. Backend MVP acceptance criteria

Backend MVP is complete only when all of these are true:

- [ ] Monorepo structure exists.
- [ ] .NET solution builds.
- [ ] PostgreSQL runs locally.
- [ ] EF Core migrations work.
- [ ] Database schema exists.
- [ ] User registration works.
- [ ] Login works.
- [ ] Refresh token flow works.
- [ ] Logout works.
- [ ] `/api/auth/me` works.
- [ ] Board creation works.
- [ ] Board listing works.
- [ ] Board access is authorized.
- [ ] Board members can be managed.
- [ ] Owner/editor/viewer permissions work.
- [ ] Post-it CRUD works.
- [ ] Post-it position is persisted.
- [ ] SignalR connection works.
- [ ] SignalR board authorization works.
- [ ] Post-it changes are broadcast after successful persistence.
- [ ] Swagger/OpenAPI is available.
- [ ] Health check works.
- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] A clean local setup is documented.

---

## 18. Explicitly out of scope for backend MVP

Do not implement yet:

- comments;
- notifications;
- attachments;
- trash;
- full audit history;
- versioning;
- public share links;
- email invitation system;
- offline synchronization;
- conflict-resolution engine;
- advanced search;
- analytics;
- microservices;
- message brokers;
- Kubernetes;
- distributed caching.

The first goal is a reliable modular monolith.

---

## 19. Backend-first execution order

The project should be executed in this order:

```text
1. Monorepo
   ↓
2. .NET solution
   ↓
3. PostgreSQL local environment
   ↓
4. EF Core + migrations
   ↓
5. User/authentication
   ↓
6. Authorization
   ↓
7. Boards
   ↓
8. Members
   ↓
9. Post-its
   ↓
10. SignalR
   ↓
11. OpenAPI + contract stabilization
   ↓
12. Backend integration tests
   ↓
13. Local backend MVP
   ↓
14. ONLY NOW start frontend
```

At every phase:

```text
Implement
   ↓
Run tests
   ↓
Run locally
   ↓
Verify behavior
   ↓
Commit
```

Do not move to the next phase when the current phase is broken.

---

## 20. First concrete milestone

The first milestone is intentionally small:

```text
Monorepo
   +
ASP.NET Core API
   +
PostgreSQL
   +
EF Core
   +
Health endpoint
   +
Swagger
   +
Clean local startup
```

Only after this milestone is working should authentication be implemented.

The objective is not to "build the whole backend" in one pass.

The objective is to establish a solid local foundation and then grow the backend one verified capability at a time.
