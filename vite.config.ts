import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Enable SPA fallback: serve index.html for all unknown paths
  // so that browser back/forward and direct URL navigation work
  appType: 'spa',
  server: {
    proxy: {
      '/storage': 'http://localhost:8000',
      '/api': 'http://localhost:8000',
      '/videos': 'http://localhost:8000',
    }
  }
})
