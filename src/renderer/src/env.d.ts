/// <reference types="vite/client" />

declare module 'virtual:whatsnew' {
  export const appVersion: string
  export const entries: {
    hash: string
    date: string
    version: string | null
    kind: 'feat' | 'fix'
    title: string
    detail: string | null
  }[]
}
