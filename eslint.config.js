// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// Layer rules (see docs/ARCHITECTURE.md). Each layer may only import what it owns.
const sdk = ['@anthropic-ai/*']
const db = ['better-sqlite3', 'drizzle-orm', 'drizzle-orm/*']
const nodeOnly = ['electron', 'node:*', 'fs', 'path', 'os', 'child_process', 'worker_threads']

/** @param {string[]} patterns @param {{ name: string, importNames: string[], message: string }[]} [paths] */
const restrict = (patterns, paths = []) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: patterns.map((group) => ({
        group: [group],
        message: 'Layer violation: see docs/ARCHITECTURE.md'
      })),
      paths
    }
  ]
})

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'coverage/**', '.claude/**', 'drizzle/**']
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always']
    }
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: restrict([
      ...nodeOnly,
      'react',
      'react-dom',
      ...sdk,
      ...db,
      '@main/*',
      '@renderer/*',
      '**/main/**',
      '**/renderer/**'
    ])
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...restrict([...nodeOnly, ...sdk, ...db, '@main/*', '**/main/**'])
    }
  },
  {
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/ai/**', 'src/main/db/**', 'src/main/ipc/**', 'src/main/index.ts', 'src/main/app/**'],
    rules: restrict(
      [...sdk, ...db, '@renderer/*'],
      [{ name: 'electron', importNames: ['ipcMain'], message: 'Only src/main/ipc may use ipcMain.' }]
    )
  },
  {
    files: ['src/main/ai/**/*.ts'],
    rules: restrict(
      [...db, '@renderer/*'],
      [{ name: 'electron', importNames: ['ipcMain'], message: 'Only src/main/ipc may use ipcMain.' }]
    )
  },
  {
    files: ['src/main/db/**/*.ts'],
    rules: restrict(
      [...sdk, '@renderer/*'],
      [{ name: 'electron', importNames: ['ipcMain'], message: 'Only src/main/ipc may use ipcMain.' }]
    )
  },
  {
    files: ['src/main/ipc/**/*.ts', 'src/main/index.ts', 'src/main/app/**/*.ts'],
    rules: restrict([...sdk, ...db, '@renderer/*'])
  },
  {
    files: ['src/preload/**/*.ts'],
    rules: restrict([...sdk, ...db, '@main/*', '@renderer/*'])
  },
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' }
  }
)
