import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
          index: resolve(import.meta.dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()]
  }
})
