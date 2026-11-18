import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/

// Dev-server proxy target: the API's HTTP Kestrel profile by default.
// Override with VITE_PROXY_TARGET, e.g. when the API runs the HTTPS profile
// (`$env:VITE_PROXY_TARGET = "https://localhost:7113"`; `secure: false` below
// then accepts its dev certificate). PLAN.FE.md §15 documents the same.
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
