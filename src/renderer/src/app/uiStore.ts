import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Zoom } from '../features/reader/zoom'

/** Per-device UI preferences (not synced to main). Server data lives in TanStack Query. */

export interface PaneState {
  open: boolean
  width: number
}

export const PANE_LIMITS = {
  left: { min: 200, max: 420, initial: 264 },
  right: { min: 320, max: 640, initial: 400 }
} as const

export type PaneSide = keyof typeof PANE_LIMITS

interface UiState {
  panes: Record<PaneSide, PaneState>
  studyTab: string
  zoom: Zoom
  setPaneWidth: (side: PaneSide, width: number) => void
  togglePane: (side: PaneSide) => void
  setStudyTab: (tab: string) => void
  setZoom: (zoom: Zoom) => void
}

const clamp = (side: PaneSide, w: number): number =>
  Math.round(Math.min(PANE_LIMITS[side].max, Math.max(PANE_LIMITS[side].min, w)))

/** localStorage can throw (private windows, blocked storage); fall back to memory. */
const safeStorage = createJSONStorage(() => {
  try {
    const probe = '__sb_probe__'
    window.localStorage.setItem(probe, probe)
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    const mem = new Map<string, string>()
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k)
    }
  }
})

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      panes: {
        left: { open: true, width: PANE_LIMITS.left.initial },
        right: { open: true, width: PANE_LIMITS.right.initial }
      },
      studyTab: 'notes',
      zoom: { mode: 'fit' },
      setPaneWidth: (side, width) =>
        set((s) => ({ panes: { ...s.panes, [side]: { ...s.panes[side], width: clamp(side, width) } } })),
      togglePane: (side) =>
        set((s) => ({ panes: { ...s.panes, [side]: { ...s.panes[side], open: !s.panes[side].open } } })),
      setStudyTab: (studyTab) => set({ studyTab }),
      setZoom: (zoom) => set({ zoom })
    }),
    { name: 'sb-ui', version: 1, storage: safeStorage }
  )
)
