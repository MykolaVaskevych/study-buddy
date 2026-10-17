import { pdfUrl } from '@shared/ipc/contract'

/** Where the viewer reads a document's bytes from. */
export type PdfSource = { kind: 'url'; url: string } | { kind: 'data'; data: Uint8Array }

export type PdfSourceResolver = (docId: string) => Promise<PdfSource>

/** In Electron the stored PDF is served by the privileged sb-pdf:// protocol. */
const electronResolver: PdfSourceResolver = (docId) => Promise.resolve({ kind: 'url', url: pdfUrl(docId) })

let resolver: PdfSourceResolver = electronResolver

/** Browser mode and tests install a resolver that serves generated PDFs (see mock.ts). */
export function setPdfSourceResolver(next: PdfSourceResolver | null): void {
  resolver = next ?? electronResolver
}

export function resolvePdfSource(docId: string): Promise<PdfSource> {
  return resolver(docId)
}
