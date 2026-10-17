import { create } from 'zustand'

export type ToastTone = 'info' | 'error' | 'ok'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  body?: string
}

interface ToastState {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

const MAX = 4
const TTL_MS = 6000
const DEDUPE_MS = 4000

let nextId = 1
const recent = new Map<string, number>()

/** Global toast queue. Identical toasts within a few seconds collapse into one. */
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const key = `${toast.tone}:${toast.title}:${toast.body ?? ''}`
    const now = Date.now()
    const last = recent.get(key)
    if (last !== undefined && now - last < DEDUPE_MS) return
    recent.set(key, now)
    const id = nextId++
    set({ toasts: [...get().toasts, { ...toast, id }].slice(-MAX) })
    setTimeout(() => get().dismiss(id), TTL_MS)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

/** Imperative helper for non-React code (query cache callbacks). */
export const toast = (t: Omit<Toast, 'id'>): void => useToasts.getState().push(t)
