import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@main': resolve(import.meta.dirname, 'src/main'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
}

// Tests run inside Electron's Node (ELECTRON_RUN_AS_NODE=1, see package.json) so the
// better-sqlite3 binary built for Electron's ABI loads in tests too.
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'tests/**/*.test.ts'],
          testTimeout: 20_000
        }
      },
      {
        resolve: { alias },
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/src/test/setup.ts']
        }
      }
    ]
  }
})
