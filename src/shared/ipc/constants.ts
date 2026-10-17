/**
 * IPC constants with no dependencies. The sandboxed preload may only require('electron'), so it
 * imports from here and never from contract.ts (which pulls in zod).
 */
export const IPC_INVOKE_PREFIX = 'sb:'
export const IPC_EVENT_PREFIX = 'sb-event:'

/** Custom protocol that serves stored PDFs to the viewer: sb-pdf://doc/<docId> */
export const PDF_SCHEME = 'sb-pdf'
export const pdfUrl = (docId: string): string => `${PDF_SCHEME}://doc/${encodeURIComponent(docId)}`
