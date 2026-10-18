/**
 * Public surface of the app module (Electron glue) for the composition root. Tests import the
 * individual files, which take Electron objects by injection; only window.ts and dialogs.ts import
 * 'electron' at runtime.
 */
export { createAiRegistry, providerFingerprint, type AiRegistry, type AiRegistryDeps } from './ai-registry'
export { pickPdfs, PDF_OPEN_DIALOG } from './dialogs'
export { createConsoleLog, type Log } from './log'
export { buildMenuTemplate } from './menu'
export {
  registerPdfProtocol,
  registerPdfScheme,
  servePdfRequest,
  PDF_SCHEME_PRIVILEGES,
  type PdfFiles
} from './pdf-protocol'
export {
  createSecretStore,
  API_KEY_SECRET,
  OPENAI_COMPATIBLE_KEY_SECRET,
  type AppSecretStore,
  type SecretCrypto
} from './secrets'
export { ensureSingleInstance } from './single-instance'
export {
  runSmoke,
  waitForRendererLoad,
  writeSmokePdf,
  SmokeError,
  type SmokeReport,
  type SmokeStep
} from './smoke'
export { decideNavigation, isAppUrl, resolveRendererSource, type RendererSource } from './url-policy'
export { createMainWindow, type MainWindowOptions } from './window'
