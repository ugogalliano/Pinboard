import preset from '@ugogalliano/pm-design-system-vue/tailwind-preset'

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
    extend: {},
  },
  plugins: [],
}
