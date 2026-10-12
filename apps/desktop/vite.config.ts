import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/

// NOTE: PLAN.FE.md §15 pins the backend at https://localhost:5001, but
// apps/server launchSettings.json actually serves https://localhost:7113
// (and http://localhost:5180). Target is configurable via VITE_PROXY_TARGET;
// the fallback is the real Kestrel https profile. Keep the doc conflict on
// record here until PLAN §15 is reconciled.
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:5180'

export default defineConfig({
  // Relative base for Tauri compatibility (PLAN.FE.md §15).
  base: './',
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
      },
      '/hubs': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
