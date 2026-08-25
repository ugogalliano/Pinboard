# PostIt Server — Architecture Documentation

## 1. Clean Architecture Layers

```mermaid
graph TD
    subgraph Api["PostIt.Api (Presentation Layer)"]
        Controllers["Controllers (Auth, Boards, Notes)"]
        Hubs["SignalR Hubs (BoardHub)"]
        Middleware["Middleware (Exception Handling, Logging)"]
    end

    subgraph Application["PostIt.Application (Business Logic Layer)"]
        Services["Services (Auth, Board, Member, Note)"]
        DTOs["DTOs (Request/Response)"]
        Interfaces["Interfaces (Repositories, Services)"]
        AuthZ["Authorization (BoardAuthorizationService)"]
    end

    subgraph Domain["PostIt.Domain (Core Domain Layer)"]
        Entities["Entities (User, Board, BoardMember, PostIt, RefreshToken)"]
        Enums["Enums (BoardMemberRole)"]
    end

    subgraph Infrastructure["PostIt.Infrastructure (Data Layer)"]
        DbContext["PostItDbContext (EF Core)"]
        Repositories["Repositories"]
        Identity["Password Hashing (Identity)"]
    end

    subgraph Database[(PostgreSQL)]
        Schema["Database Schema"]
    end

    Api --> Application
    Application --> Domain
    Infrastructure --> Application
    Infrastructure --> Domain
    Infrastructure --> Database
```

## 2. Domain Model

```mermaid
erDiagram
    USER ||--o{ BOARD : "creates"
    USER ||--o{ BOARD_MEMBER : "belongs to"
    BOARD ||--o{ BOARD_MEMBER : "has"
    BOARD ||--o{ POST_IT : "contains"
    USER ||--o{ POST_IT : "creates"
    USER ||--o{ REFRESH_TOKEN : "has"

    USER {
        uuid Id PK
        string Email
        string NormalizedEmail
        string PasswordHash
        string DisplayName
        datetime CreatedAt
        datetime UpdatedAt
    }

    BOARD {
        uuid Id PK
        string Name
        uuid CreatedBy FK
        datetime CreatedAt
        datetime UpdatedAt
    }

    BOARD_MEMBER {
        uuid Id PK
        uuid BoardId FK
        uuid UserId FK
        enum Role
        datetime CreatedAt
    }

    POST_IT {
        uuid Id PK
        uuid BoardId FK
        uuid CreatedBy FK
        string Content
        string Color
        int PositionX
        int PositionY
        datetime CreatedAt
        datetime UpdatedAt
    }

    REFRESH_TOKEN {
        uuid Id PK
        string Token
        uuid UserId FK
        datetime ExpiresAt
        datetime CreatedAt
        datetime RevokedAt
        string ReplacedByToken
    }
```

## 3. API Endpoints

### Authentication
```
POST /api/auth/register      → Register new user
POST /api/auth/login         → Login, returns JWT + refresh token
POST /api/auth/refresh       → Refresh tokens (rotates refresh token)
POST /api/auth/logout        → Revoke refresh token
GET  /api/auth/me            → Get current user
```

### Boards
```
GET    /api/boards           → List boards (member only)
POST   /api/boards           → Create board (becomes Owner)
GET    /api/boards/{id}      → Get board details
PUT    /api/boards/{id}      → Update board (Owner only)
DELETE /api/boards/{id}      → Delete board (Owner only)
```

### Board Members
```
GET    /api/boards/{id}/members           → List members
POST   /api/boards/{id}/members           → Add member (Owner only)
PUT    /api/boards/{id}/members/{userId}  → Update role (Owner only)
DELETE /api/boards/{id}/members/{userId}  → Remove member (Owner only)
```

### Notes (Post-its)
```
GET    /api/boards/{id}/notes     → List notes
POST   /api/boards/{id}/notes     → Create note (Owner/Editor)
PUT    /api/notes/{id}            → Update note (Owner/Editor)
DELETE /api/notes/{id}            → Delete note (Owner/Editor)
```

### Realtime
```
/hubs/boards  → SignalR hub for realtime collaboration
```

### Health
```
GET /health   → Health check (includes database)
```

## 4. Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant AuthService
    participant TokenService
    participant DB

    Client->>API: POST /api/auth/register (email, password, displayName)
    API->>AuthService: RegisterAsync(...)
    AuthService->>DB: Create User
    AuthService-->>API: UserDto
    API-->>Client: 201 Created

    Client->>API: POST /api/auth/login (email, password)
    API->>AuthService: LoginAsync(...)
    AuthService->>DB: Find user by email
    AuthService->>AuthService: Verify password hash
    AuthService->>TokenService: Generate JWT + Refresh Token
    TokenService->>DB: Store refresh token
    AuthService-->>API: LoginResponse (accessToken, refreshToken, expiresAt)
    API-->>Client: 200 OK

    Client->>API: GET /api/auth/me (Authorization: Bearer {token})
    API->>API: Validate JWT
    API->>AuthService: GetUserAsync(userId)
    AuthService->>DB: Find user
    AuthService-->>API: UserDto
    API-->>Client: 200 OK

    Client->>API: POST /api/auth/refresh (refreshToken)
    API->>AuthService: RefreshAsync(token)
    AuthService->>DB: Find refresh token
    AuthService->>AuthService: Validate (not revoked, not expired)
    AuthService->>TokenService: Generate new JWT + Refresh Token
    TokenService->>DB: Revoke old token, store new token
    AuthService-->>API: LoginResponse
    API-->>Client: 200 OK

    Client->>API: POST /api/auth/logout (refreshToken)
    API->>AuthService: LogoutAsync(token)
    AuthService->>DB: Revoke refresh token
    API-->>Client: 204 No Content
```

## 5. Board CRUD Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant BoardService
    participant AuthZ
    participant DB

    Client->>API: POST /api/boards (name) [JWT]
    API->>BoardService: CreateBoardAsync(name, userId)
    BoardService->>DB: Create Board (CreatedBy = userId)
    BoardService->>DB: Create BoardMember (Owner)
    BoardService->>DB: SaveChangesAsync()
    BoardService-->>API: BoardDto
    API-->>Client: 201 Created

    Client->>API: GET /api/boards [JWT]
    API->>BoardService: GetBoardsAsync(userId)
    BoardService->>DB: Query boards where user is member
    BoardService-->>API: List<BoardDto>
    API-->>Client: 200 OK

    Client->>API: PUT /api/boards/{id} (name) [JWT]
    API->>BoardService: UpdateBoardAsync(id, name, userId)
    BoardService->>AuthZ: CanEditBoardAsync(userId, boardId)
    AuthZ->>DB: Check member role = Owner
    AuthZ-->>BoardService: true/false
    BoardService->>DB: Update Board
    BoardService-->>API: BoardDto
    API-->>Client: 200 OK / 403 Forbidden
```

## 6. SignalR Realtime Flow

```mermaid
sequenceDiagram
    participant Client
    participant BoardHub
    participant AuthZ
    participant NoteService
    participant DB
    participant IHubContext

    Client->>BoardHub: Connect + JoinBoard(boardId)
    BoardHub->>AuthZ: CanReadBoardAsync(userId, boardId)
    AuthZ-->>BoardHub: true
    BoardHub->>BoardHub: Groups.AddAsync(userId, "board:{boardId}")
    BoardHub-->>Client: Joined

    Client->>API: POST /api/boards/{id}/notes (content, color, x, y) [JWT]
    API->>NoteService: CreateNoteAsync(...)
    NoteService->>AuthZ: CanCreatePostItAsync(userId, boardId)
    AuthZ-->>NoteService: true
    NoteService->>DB: Create PostIt
    NoteService->>DB: SaveChangesAsync()
    NoteService->>IHubContext: Clients.Group("board:{boardId}").PostItCreated(noteDto)
    IHubContext->>Client: PostItCreated event
    NoteService-->>API: NoteDto
    API-->>Client: 201 Created
```

## 7. Authorization Matrix

| Action | Owner | Editor | Viewer |
|--------|-------|--------|--------|
| Read Board | ✅ | ✅ | ✅ |
| Edit Board | ✅ | ❌ | ❌ |
| Create Post-it | ✅ | ✅ | ❌ |
| Edit Post-it | ✅ | ✅ | ❌ |
| Delete Post-it | ✅ | ✅ | ❌ |
| Manage Members | ✅ | ❌ | ❌ |

## 8. Project Structure

```
apps/server/
├── PostIt.sln
├── Directory.Build.props
├── .editorconfig
├── docker-compose.yml
├── README.md
├── ARCHITECTURE.md
├── src/
│   ├── PostIt.Api/
│   │   ├── Controllers/
│   │   │   ├── AuthController.cs
│   │   │   ├── BoardsController.cs
│   │   │   └── NotesController.cs
│   │   ├── Hubs/
│   │   │   └── BoardHub.cs
│   │   ├── Middleware/
│   │   │   └── ExceptionHandlingMiddleware.cs
│   │   ├── Services/
│   │   │   └── BoardNotificationService.cs
│   │   ├── Program.cs
│   │   └── appsettings*.json
│   ├── PostIt.Application/
│   │   ├── DTOs/
│   │   ├── Interfaces/
│   │   ├── Services/
│   │   └── DependencyInjection.cs
│   ├── PostIt.Domain/
│   │   └── Entities/
│   └── PostIt.Infrastructure/
│       ├── Persistence/
│       │   ├── PostItDbContext.cs
│       │   ├── Repositories/
│       │   └── Migrations/
│       └── DependencyInjection.cs
└── tests/
    ├── PostIt.UnitTests/
    └── PostIt.IntegrationTests/
```

## 9. Technology Stack

- **.NET 8** — Runtime and framework
- **ASP.NET Core Web API** — HTTP API
- **SignalR** — Realtime communication
- **Entity Framework Core 8** — ORM
- **PostgreSQL** — Primary database
- **Npgsql** — PostgreSQL driver for EF Core
- **JWT** — Authentication tokens
- **ASP.NET Core Identity** — Password hashing only
- **xUnit** — Testing framework
- **Testcontainers** — Integration test database (with SQLite fallback)
- **Swagger/OpenAPI** — API documentation
- **Serilog** — Structured logging
