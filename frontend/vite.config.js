import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',   // expose on all network interfaces so mobile can reach it
    https: {
      key:  fs.readFileSync(path.resolve(__dirname, '../key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, '../cert.pem')),
    },
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:5443',
        changeOrigin: true,
        secure: false,   // allow self-signed cert in dev
      },
      '/static': {
        target: 'https://127.0.0.1:5443',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // Serve attendai.crt from project root so phones can download it
  publicDir: path.resolve(__dirname, '../'),
  build: {
    outDir: '../static/react',
    emptyOutDir: true,
  },
})
