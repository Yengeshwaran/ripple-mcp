import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/voice': {
        target: 'http://localhost:8002',
        changeOrigin: true,
      },
      '/mcp': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
})
