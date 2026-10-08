import { z } from 'zod'

import { NOTE_COLOR_NAMES } from '../constants/note-colors'

// Single source of truth for all client-side validation (PLAN.FE.md §4/§5,
// AGENTS.md §4). Limits mirror the backend exactly: board name ≤200,
// note content ≤1000, color from the shared palette (≤50 naturally),
// role ∈ {Editor, Viewer}, email required + format.

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const registerSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  displayName: z.string().min(1, 'Display name is required'),
})

export const boardNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Board name is required')
    .max(200, 'Board name must be at most 200 characters'),
})

// Note color must be one of the shared palette tokens; membership implies the
// backend's required-≤50-char limit by construction (longest token < 50).
export const noteColorSchema = z.enum(NOTE_COLOR_NAMES, { message: 'Pick a valid note color' })

export const noteSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Note content is required')
    .max(1000, 'Note content must be at most 1000 characters'),
  color: noteColorSchema,
  positionX: z.number({ message: 'X position must be a number' }),
  positionY: z.number({ message: 'Y position must be a number' }),
})

export const memberSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  role: z.enum(['Editor', 'Viewer'], { message: 'Role must be Editor or Viewer' }),
})

export const updateMemberSchema = z.object({
  role: z.enum(['Editor', 'Viewer'], { message: 'Role must be Editor or Viewer' }),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type BoardNameInput = z.infer<typeof boardNameSchema>
export type NoteInput = z.infer<typeof noteSchema>
export type MemberInput = z.infer<typeof memberSchema>
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>
