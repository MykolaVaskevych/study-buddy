import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Base path the viewer passes to pdf.js (standardFontDataUrl / cMapUrl / wasmUrl). */
export const PDFJS_ASSET_BASE = 'pdfjs/'
const DIRS = ['standard_fonts', 'cmaps', 'wasm'] as const

/**
 * Serves pdf.js's non-embedded fonts, CMaps (CJK) and wasm decoders (JPX, JBIG2) under
 * /pdfjs/<dir>/ in dev and copies them into the renderer build. pdf.js needs stable file
 * names, so they cannot go through Vite's hashed asset pipeline.
 */
export function pdfjsAssets(root: string): Plugin {
  const src = resolve(root, 'node_modules/pdfjs-dist')
  return {
    name: 'study-buddy:pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? ''
        const match = /^\/pdfjs\/(standard_fonts|cmaps|wasm)\/([^/]+)$/.exec(url)
        if (!match?.[1] || !match[2]) return next()
        const file = normalize(join(src, match[1], match[2]))
        if (!file.startsWith(src) || !existsSync(file) || !statSync(file).isFile()) return next()
        createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const dir of DIRS) {
        for (const name of readdirSync(join(src, dir))) {
          const file = join(src, dir, name)
          if (statSync(file).isFile())
            this.emitFile({
              type: 'asset',
              fileName: `${PDFJS_ASSET_BASE}${dir}/${name}`,
              source: readFileSync(file)
            })
        }
      }
    }
  }
}
