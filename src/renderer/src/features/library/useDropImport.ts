import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { isImportable } from '@shared/files'
import { pathForFile } from '../../api/client'

const canImport = (f: File): boolean => f.type === 'application/pdf' || isImportable(f.name)

export interface DropResult {
  /** Absolute paths for main, or null when the bridge can't resolve dropped files. */
  paths: string[] | null
  rejected: number
}

/** Pure part of the drop handler: keep importable files (PDF, office) and resolve their paths. */
export function resolveDrop(files: File[], resolve: (f: File) => string | null = pathForFile): DropResult {
  const kept = files.filter(canImport)
  const paths = kept.map(resolve).filter((p): p is string => p !== null)
  return { paths: paths.length === kept.length ? paths : null, rejected: files.length - kept.length }
}

/** Drag-and-drop state for a drop zone; the counter survives dragenter/leave on children. */
export function useDropImport(onDrop: (result: DropResult) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const hasFiles = (e: DragEvent): boolean => e.dataTransfer.types.includes('Files')

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth.current += 1
    setOver(true)
  }, [])
  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDragLeave = useCallback(() => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }, [])
  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      onDrop(resolveDrop([...e.dataTransfer.files]))
    },
    [onDrop]
  )
  return { over, bind: { onDragEnter, onDragOver, onDragLeave, onDrop: handleDrop } }
}
