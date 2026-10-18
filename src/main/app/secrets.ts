import type { SettingsRepo } from '../db/types'
import type { SecretStore } from '../pipelines/types'
import type { Log } from './log'

/**
 * API key storage on top of the settings repo's secret blobs, encrypted with Electron `safeStorage`.
 *
 * Blob format: one header byte, then the payload.
 *   0x01 = safeStorage ciphertext
 *   0x00 = UTF-8 plaintext, used only when the OS offers no encryption at all (Linux without a
 *          keyring). The key is still stored so the app works; `isWeak()` lets the UI warn.
 * A plaintext blob is upgraded to ciphertext the first time it is read while encryption is available.
 *
 * The key never appears in logs or error messages.
 */

/** The parts of Electron's `safeStorage` used here (injected so tests use a fake). */
export interface SecretCrypto {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only: 'basic_text' means "encrypted" with a hard-coded password, i.e. not protected. */
  getSelectedStorageBackend?(): string
}

/** SecretStore plus a weak-storage flag. Additive to the pipelines contract, not part of it. */
export interface AppSecretStore extends SecretStore {
  /** True when the key is, or would be, stored without real OS keychain protection. */
  isWeak(): boolean
}

export const API_KEY_SECRET = 'anthropicApiKey'
/** Key for an OpenAI-compatible server (DeepSeek, OpenRouter, ...). */
export const OPENAI_COMPATIBLE_KEY_SECRET = 'openaiCompatibleApiKey'

const ENCRYPTED = 0x01
const PLAIN = 0x00

export function createSecretStore(
  repo: Pick<SettingsRepo, 'getSecret' | 'setSecret'>,
  crypto: SecretCrypto,
  opts: { log?: Log; name?: string } = {}
): AppSecretStore {
  const name = opts.name ?? API_KEY_SECRET
  const { log } = opts
  // Decrypting can hit the OS keyring; the AI registry reads the key on every lookup, so cache it.
  let cache: { key: string | null } | null = null

  const backendIsBasicText = (): boolean => {
    if (typeof crypto.getSelectedStorageBackend !== 'function') return false
    try {
      return crypto.getSelectedStorageBackend() === 'basic_text'
    } catch {
      return false
    }
  }
  const canEncrypt = (): boolean => crypto.isEncryptionAvailable()

  function encode(key: string): Buffer {
    if (!canEncrypt()) return Buffer.concat([Buffer.from([PLAIN]), Buffer.from(key, 'utf8')])
    return Buffer.concat([Buffer.from([ENCRYPTED]), crypto.encryptString(key)])
  }

  function decode(blob: Buffer): string | null {
    const header = blob[0]
    const payload = blob.subarray(1)
    if (header === PLAIN) {
      const key = payload.toString('utf8')
      if (canEncrypt()) {
        repo.setSecret(name, encode(key))
        log?.info('Stored API key is now encrypted with the OS keychain')
      }
      return key
    }
    if (header === ENCRYPTED) {
      if (!canEncrypt()) {
        log?.warn('Stored API key cannot be decrypted: OS encryption is unavailable')
        return null
      }
      try {
        return crypto.decryptString(payload)
      } catch {
        // Typically a changed or reset keyring. The user has to enter the key again.
        log?.warn('Stored API key could not be decrypted; it must be entered again')
        return null
      }
    }
    log?.warn('Stored API key has an unknown format; ignoring it')
    return null
  }

  return {
    getApiKey() {
      if (cache === null) {
        const blob = repo.getSecret(name)
        cache = { key: blob === null || blob.length === 0 ? null : decode(blob) }
      }
      return cache.key
    },

    setApiKey(key) {
      repo.setSecret(name, key === null ? null : encode(key))
      cache = { key }
      if (key !== null && !canEncrypt())
        log?.warn('OS encryption unavailable: API key stored without encryption')
    },

    isWeak() {
      const blob = repo.getSecret(name)
      if (blob !== null && blob[0] === PLAIN) return true
      return !canEncrypt() || backendIsBasicText()
    }
  }
}
