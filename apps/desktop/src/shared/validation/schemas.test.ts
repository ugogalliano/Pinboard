import { describe, expect, it } from 'vitest'

import { NOTE_COLOR_NAMES } from '../constants/note-colors'

import {
  boardNameSchema,
  loginSchema,
  memberSchema,
  noteColorSchema,
  noteSchema,
  refreshSchema,
  registerSchema,
  updateMemberSchema,
} from './schemas'

describe('loginSchema', () => {
  it('accepts valid credentials', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'hunter2' }).success).toBe(true)
  })

  it('rejects a missing field', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co' }).success).toBe(false)
    expect(loginSchema.safeParse({ password: 'x' }).success).toBe(false)
    expect(loginSchema.safeParse({ email: '', password: 'x' }).success).toBe(false)
  })

  it('rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false)
  })
})

describe('registerSchema', () => {
  it('accepts a complete registration', () => {
    expect(
      registerSchema.safeParse({ email: 'a@b.co', password: 'hunter2', displayName: 'Ada' })
        .success,
    ).toBe(true)
  })

  it('rejects a missing displayName', () => {
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(false)
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'x', displayName: '' }).success).toBe(
      false,
    )
  })

  it('rejects a malformed email', () => {
    expect(
      registerSchema.safeParse({ email: 'a@b', password: 'x', displayName: 'Ada' }).success,
    ).toBe(false)
  })
})

describe('boardNameSchema', () => {
  it('accepts a name up to 200 chars and trims it', () => {
    expect(boardNameSchema.safeParse({ name: 'Product Launch' }).success).toBe(true)
    expect(boardNameSchema.safeParse({ name: 'x'.repeat(200) }).success).toBe(true)

    const parsed = boardNameSchema.parse({ name: '  spaced  ' })
    expect(parsed.name).toBe('spaced')
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(boardNameSchema.safeParse({ name: '' }).success).toBe(false)
    expect(boardNameSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('rejects a 201-char name', () => {
    expect(boardNameSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false)
  })
})

describe('noteSchema', () => {
  const position = { positionX: 120, positionY: 48 }

  it('accepts valid content with a palette color and position', () => {
    expect(noteSchema.safeParse({ content: 'Idea', color: 'note-yellow', ...position }).success).toBe(
      true,
    )
    expect(
      noteSchema.safeParse({ content: 'x'.repeat(1000), color: 'note-teal', ...position }).success,
    ).toBe(true)
  })

  it('trims content and rejects whitespace-only content', () => {
    const parsed = noteSchema.parse({ content: '  hi  ', color: 'note-pink', ...position })
    expect(parsed.content).toBe('hi')
    expect(noteSchema.safeParse({ content: '   ', color: 'note-pink', ...position }).success).toBe(
      false,
    )
  })

  it('rejects 1001 chars of content and empty content', () => {
    expect(noteSchema.safeParse({ content: 'x'.repeat(1001), color: 'note-blue', ...position }).success).toBe(
      false,
    )
    expect(noteSchema.safeParse({ content: '', color: 'note-blue', ...position }).success).toBe(false)
  })

  it('rejects a color outside the palette (raw hex, unknown token, oversized)', () => {
    expect(noteSchema.safeParse({ content: 'x', color: '#zzz', ...position }).success).toBe(false)
    expect(noteSchema.safeParse({ content: 'x', color: 'note-unknown', ...position }).success).toBe(false)
    expect(noteSchema.safeParse({ content: 'x', color: 'c'.repeat(60), ...position }).success).toBe(false)
  })

  it('requires numeric position fields', () => {
    expect(noteSchema.safeParse({ content: 'x', color: 'note-green' }).success).toBe(false)
    expect(
      noteSchema.safeParse({ content: 'x', color: 'note-green', positionX: 10 }).success,
    ).toBe(false)
    expect(
      noteSchema
        .safeParse({ content: 'x', color: 'note-green', positionX: 'ten', positionY: 0 })
        .success,
    ).toBe(false)
  })
})

describe('noteColorSchema', () => {
  it('accepts every palette token and rejects anything else', () => {
    for (const name of NOTE_COLOR_NAMES) {
      expect(noteColorSchema.safeParse(name).success).toBe(true)
    }
    expect(noteColorSchema.safeParse('yellow').success).toBe(false)
    expect(noteColorSchema.safeParse('#fcf292').success).toBe(false)
    expect(noteColorSchema.safeParse('').success).toBe(false)
  })
})

describe('memberSchema', () => {
  it('accepts an assignable role with a valid email', () => {
    expect(memberSchema.safeParse({ email: 'a@b.co', role: 'Editor' }).success).toBe(true)
    expect(memberSchema.safeParse({ email: 'a@b.co', role: 'Viewer' }).success).toBe(true)
  })

  it('rejects a bad role and a bad email', () => {
    expect(memberSchema.safeParse({ email: 'a@b.co', role: 'Owner' }).success).toBe(false)
    expect(memberSchema.safeParse({ email: 'a@b.co', role: 'editor' }).success).toBe(false)
    expect(memberSchema.safeParse({ email: 'nope', role: 'Editor' }).success).toBe(false)
    expect(memberSchema.safeParse({ role: 'Editor' }).success).toBe(false)
  })
})

describe('updateMemberSchema', () => {
  it('accepts Editor/Viewer and rejects everything else', () => {
    expect(updateMemberSchema.safeParse({ role: 'Viewer' }).success).toBe(true)
    expect(updateMemberSchema.safeParse({ role: 'Owner' }).success).toBe(false)
    expect(updateMemberSchema.safeParse({}).success).toBe(false)
  })
})

describe('refreshSchema', () => {
  it('requires a refresh token', () => {
    expect(refreshSchema.safeParse({ refreshToken: 'r1' }).success).toBe(true)
    expect(refreshSchema.safeParse({ refreshToken: '' }).success).toBe(false)
    expect(refreshSchema.safeParse({}).success).toBe(false)
  })
})
