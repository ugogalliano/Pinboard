# PostIt Server

Backend API for the PostIt board application.

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Docker](https://www.docker.com/) (for PostgreSQL)

## Build

```bash
cd apps/server
dotnet build
```

## Run Tests

```bash
cd apps/server
dotnet test
```

Unit tests run without any external dependencies. Integration tests use Testcontainers (PostgreSQL) when Docker is available, and automatically fall back to SQLite when it is not.

## Start PostgreSQL

```bash
cd apps/server
docker compose up -d
```

## Apply Migrations

```bash
cd apps/server/src/PostIt.Api
dotnet ef database update
```

## Run the API

```bash
cd apps/server/src/PostIt.Api
dotnet run
```

The API will be available at `https://localhost:5001` (or `http://localhost:5000`).

## API Endpoint Overview

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/register` | Register a new account | No |
| POST | `/api/auth/login` | Login and receive tokens | No |
| POST | `/api/auth/refresh` | Refresh access token | No |
| POST | `/api/auth/logout` | Revoke refresh token | No |
| GET | `/api/auth/me` | Get current user profile | Bearer |

### Boards

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/boards` | List boards for current user | Bearer |
| POST | `/api/boards` | Create a new board | Bearer |
| GET | `/api/boards/{boardId}` | Get a specific board | Bearer |
| PUT | `/api/boards/{boardId}` | Update board name | Bearer |
| DELETE | `/api/boards/{boardId}` | Delete a board | Bearer |

### Board Members

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/boards/{boardId}/members` | List board members | Bearer |
| POST | `/api/boards/{boardId}/members` | Add a member | Bearer |
| PUT | `/api/boards/{boardId}/members/{userId}` | Update member role | Bearer |
| DELETE | `/api/boards/{boardId}/members/{userId}` | Remove a member | Bearer |

### Notes

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/boards/{boardId}/notes` | List notes on a board | Bearer |
| POST | `/api/boards/{boardId}/notes` | Create a note | Bearer |
| PUT | `/api/notes/{noteId}` | Update a note | Bearer |
| DELETE | `/api/notes/{noteId}` | Delete a note | Bearer |

### Health & Diagnostics

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/health` | Health check (includes DB) | No |
| GET | `/api/ping` | Simple ping endpoint | No |

### SignalR

| Path | Description | Auth |
|------|-------------|------|
| `/hubs/board` | Real-time board updates | Bearer (via query string) |

## Swagger

When running in Development mode, Swagger UI is available at `/swagger`.
