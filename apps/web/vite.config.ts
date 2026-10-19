import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mcp': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
})
