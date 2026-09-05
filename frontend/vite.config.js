import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // Development-only transport. Production serves the SPA and /api behind the
  // same TLS reverse proxy, so the browser uses HTTPS and WSS only.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'ws://localhost:3001', ws: true },
    },
  },
})
