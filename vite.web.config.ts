import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pdfjsAssets } from './build-tools/pdfjs-assets.ts'
import { whatsnew } from './build-tools/whatsnew.ts'

/**
 * Browser mode (`npm run dev:web`): the renderer alone in a normal browser. With no preload
 * bridge present, main.tsx installs the in-memory mock api (src/renderer/src/api/mock.ts).
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss(), pdfjsAssets(import.meta.dirname), whatsnew(import.meta.dirname)],
  server: { port: 5174, strictPort: false }
})
