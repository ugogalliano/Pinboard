// Sticky-note palette from design_pinboard.pen (Sticky Notes Row / Post-it
// component). The palette token names (`note-yellow`, …) are what the backend
// stores in `Note.Color`; consumers style notes with inline `:style` from
// this map — never dynamic `bg-${color}` classes (Tailwind cannot see them).

/** name → hex, e.g. `NOTE_COLORS['note-yellow'] === '#fcf292'`. */
export const NOTE_COLORS = {
  'note-yellow': '#fcf292',
  'note-orange': '#fcc288',
  'note-pink': '#f9b4c5',
  'note-purple': '#debcf5',
  'note-blue': '#a8dffa',
  'note-teal': '#a0eee4',
  'note-green': '#b0e8c3',
  'note-red': '#f9b8b8',
} as const satisfies Record<string, string>

export type NoteColor = keyof typeof NOTE_COLORS

/** Tuple of every palette token, for `z.enum` membership validation. */
export const NOTE_COLOR_NAMES = Object.keys(NOTE_COLORS) as [NoteColor, ...NoteColor[]]

/**
 * Same hexes in Tailwind's `theme.extend.colors.note` shape — derived from
 * NOTE_COLORS (single source of truth; do not hand-edit): the `note-` prefix
 * becomes the namespace itself, so `note-yellow` maps to the `note.yellow`
 * key that generates the `bg-note-yellow` utilities. Imported by
 * tailwind.config.js (loaded through jiti, which resolves the .ts file).
 */
export const NOTE_COLORS_TAILWIND = Object.fromEntries(
  Object.entries(NOTE_COLORS).map(([name, hex]) => [name.slice('note-'.length), hex]),
) as Record<string, string>
