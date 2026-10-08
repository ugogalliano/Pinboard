// DTO mirrors of apps/server/src/PostIt.Application/DTOs (GUIDs are strings,
// DateTimes are ISO-8601 strings in JSON). Types match backend records
// field-for-field — see PLAN.FE.md §4.

// ── Auth ────────────────────────────────────────────────────────────────
export interface RegisterRequest {
  email: string
  password: string
  displayName: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  /** Backend `DateTime ExpiresAt` → ISO-8601 string. */
  expiresAt: string
}

export interface RefreshRequest {
  refreshToken: string
}

export interface MeResponse {
  id: string
  email: string
  displayName: string
}

// ── Roles ───────────────────────────────────────────────────────────────
// Strings mirror backend JSON casing exactly.
export type BoardRole = 'Owner' | 'Editor' | 'Viewer'
/** Owner is never assignable by clients (creator only). */
export type AssignableRole = 'Editor' | 'Viewer'

// ── Boards ──────────────────────────────────────────────────────────────
export interface BoardDto {
  id: string
  name: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CreateBoardRequest {
  name: string
}

export interface UpdateBoardRequest {
  name: string
}

// ── Members ─────────────────────────────────────────────────────────────
export interface BoardMemberDto {
  userId: string
  email: string
  displayName: string
  role: BoardRole
  createdAt: string
}

export interface AddMemberRequest {
  email: string
  role: AssignableRole
}

export interface UpdateMemberRequest {
  role: AssignableRole
}

// ── Notes ───────────────────────────────────────────────────────────────
export interface NoteDto {
  id: string
  boardId: string
  /** Backend `Guid? CreatedBy` — null when the author was deleted. */
  createdBy: string | null
  content: string
  color: string
  positionX: number
  positionY: number
  createdAt: string
  updatedAt: string
}

export interface CreateNoteRequest {
  content: string
  color: string
  positionX: number
  positionY: number
}

export interface UpdateNoteRequest {
  content: string
  color: string
  positionX: number
  positionY: number
}

// ── Errors ──────────────────────────────────────────────────────────────
export interface ProblemDetails {
  type?: string
  title?: string
  status: number
  detail?: string
  errors?: Record<string, string[]>
}
