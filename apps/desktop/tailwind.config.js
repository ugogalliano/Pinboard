import preset from '@ugogalliano/pm-design-system-vue/tailwind-preset'
import { NOTE_COLORS_TAILWIND } from './src/shared/constants/note-colors'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{vue,ts,tsx}',
    // Tailwind 3 resolves preset `content` globs relative to the preset file
    // (inside node_modules), so the design-system dist must be scanned here,
    // at the app root, for its component utilities to be generated.
    './node_modules/@ugogalliano/pm-design-system-vue/dist/**/*.{js,cjs,mjs}',
  ],
  theme: {
    extend: {
      // Fixed brand surfaces from design_pinboard.pen — intentionally NOT
      // themeable (unlike the preset's semantic CSS-variable colors), so no
      // new CSS vars are introduced for them.
      colors: {
        sidebar: '#f6f3ed',
        canvas: '#f1eeea',
        // Derived from NOTE_COLORS in src/shared/constants/note-colors.ts —
        // single source of truth; keys here generate `bg-note-*` utilities.
        note: NOTE_COLORS_TAILWIND,
      },
    },
  },
  plugins: [],
}
