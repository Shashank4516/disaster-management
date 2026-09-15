import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const backend = 'http://localhost:3000'

const proxy = {
  '/api': backend,
  '/health': backend,
  '/db': backend,
  '/ingest': backend,
  '/risk': backend,
  '/simulator': backend,
  '/ws': { target: backend, ws: true },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy,
  },
  preview: {
    proxy,
  },
  optimizeDeps: {
    include: ['react-apexcharts', 'apexcharts', 'react-bootstrap'],
  },
})
