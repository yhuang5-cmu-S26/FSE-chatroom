import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'

const tlsKeyPath = process.env.VITE_TLS_KEY_PATH
const tlsCertPath = process.env.VITE_TLS_CERT_PATH
const tls = tlsKeyPath && tlsCertPath ? { key: fs.readFileSync(tlsKeyPath), cert: fs.readFileSync(tlsCertPath) } : undefined
const backendTarget = process.env.VITE_BACKEND_URL || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // Development-only transport. Production serves the SPA and /api behind the
  // same TLS reverse proxy, so the browser uses HTTPS and WSS only.
  server: {
    port: 5173,
    strictPort: true,
    https: tls,
    proxy: {
      '/api': { target: backendTarget, changeOrigin: true, secure: false },
      '/socket.io': { target: backendTarget, ws: true, secure: false },
    },
  },
})
