import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pdfjsAssets } from './build-tools/pdfjs-assets'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@main': resolve(import.meta.dirname, 'src/main'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // worker_threads entry for PDF extraction/chunking; the library resolves it next to index.js.
          'pdf-worker': resolve(import.meta.dirname, 'src/main/library/pdf-worker.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preloads can only require('electron'): bundle everything else into the file.
      externalizeDeps: false,
      // Sandboxed preload scripts must be CommonJS.
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss(), pdfjsAssets(import.meta.dirname)]
  }
})
