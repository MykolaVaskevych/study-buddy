import { describe, expect, it, vi } from 'vitest'
import { memoryLog } from '../ipc/test-helpers'
import { API_KEY_SECRET, createSecretStore, type SecretCrypto } from './secrets'

const KEY = 'sk-ant-api03-very-secret-key'

function memoryRepo() {
  const blobs = new Map<string, Buffer>()
  return {
    blobs,
    getSecret: (name: string) => blobs.get(name) ?? null,
    setSecret: (name: string, value: Buffer | null) => {
      if (value === null) blobs.delete(name)
      else blobs.set(name, Buffer.from(value))
    }
  }
}

/** Reversible, obviously-not-plaintext "encryption" with switchable availability. */
function fakeCrypto(opts: { available?: boolean; backend?: string } = {}) {
  const state = { available: opts.available ?? true, failDecrypt: false }
  const crypto = {
    isEncryptionAvailable: () => state.available,
    encryptString: vi.fn((plain: string) => Buffer.from(`enc:${[...plain].reverse().join('')}`)),
    decryptString: vi.fn((blob: Buffer) => {
      if (state.failDecrypt) throw new Error('Error while decrypting the ciphertext provided')
      return [...blob.toString().replace(/^enc:/, '')].reverse().join('')
    }),
    ...(opts.backend === undefined ? {} : { getSelectedStorageBackend: () => opts.backend ?? 'unknown' })
  } satisfies SecretCrypto
  return { crypto, state }
}

describe('createSecretStore', () => {
  it('encrypts the key and reads it back in a fresh store', () => {
    const repo = memoryRepo()
    const { crypto } = fakeCrypto()
    createSecretStore(repo, crypto).setApiKey(KEY)

    const blob = repo.blobs.get(API_KEY_SECRET)
    expect(blob?.[0]).toBe(0x01)
    expect(blob?.toString()).not.toContain(KEY)
    expect(createSecretStore(repo, crypto).getApiKey()).toBe(KEY)
  })

  it('removes the key', () => {
    const repo = memoryRepo()
    const store = createSecretStore(repo, fakeCrypto().crypto)
    store.setApiKey(KEY)
    store.setApiKey(null)
    expect(repo.blobs.has(API_KEY_SECRET)).toBe(false)
    expect(store.getApiKey()).toBeNull()
    expect(createSecretStore(repo, fakeCrypto().crypto).getApiKey()).toBeNull()
  })

  it('returns null when no key was ever stored', () => {
    expect(createSecretStore(memoryRepo(), fakeCrypto().crypto).getApiKey()).toBeNull()
  })

  it('decrypts once and then serves the key from memory', () => {
    const repo = memoryRepo()
    const { crypto } = fakeCrypto()
    createSecretStore(repo, crypto).setApiKey(KEY)
    const store = createSecretStore(repo, crypto)
    store.getApiKey()
    store.getApiKey()
    expect(crypto.decryptString).toHaveBeenCalledTimes(1)
  })

  it('still stores the key without OS encryption, flags it weak and warns without the key', () => {
    const repo = memoryRepo()
    const log = memoryLog()
    const store = createSecretStore(repo, fakeCrypto({ available: false }).crypto, { log })
    expect(store.isWeak()).toBe(true)
    store.setApiKey(KEY)
    expect(repo.blobs.get(API_KEY_SECRET)?.[0]).toBe(0x00)
    expect(createSecretStore(repo, fakeCrypto({ available: false }).crypto).getApiKey()).toBe(KEY)
    expect(log.lines.some((l) => l.level === 'warn')).toBe(true)
    expect(log.text()).not.toContain(KEY)
  })

  it('treats the basic_text backend (hard-coded password) as weak', () => {
    expect(createSecretStore(memoryRepo(), fakeCrypto({ backend: 'basic_text' }).crypto).isWeak()).toBe(true)
    expect(createSecretStore(memoryRepo(), fakeCrypto({ backend: 'gnome_libsecret' }).crypto).isWeak()).toBe(
      false
    )
    expect(createSecretStore(memoryRepo(), fakeCrypto().crypto).isWeak()).toBe(false)
  })

  it('upgrades a plaintext key once encryption becomes available', () => {
    const repo = memoryRepo()
    const { crypto, state } = fakeCrypto({ available: false })
    createSecretStore(repo, crypto).setApiKey(KEY)

    state.available = true
    const store = createSecretStore(repo, crypto)
    expect(store.getApiKey()).toBe(KEY)
    expect(repo.blobs.get(API_KEY_SECRET)?.[0]).toBe(0x01)
    expect(store.isWeak()).toBe(false)
  })

  it('returns null and warns without the key when decryption fails', () => {
    const repo = memoryRepo()
    const { crypto, state } = fakeCrypto()
    createSecretStore(repo, crypto).setApiKey(KEY)
    state.failDecrypt = true
    const log = memoryLog()
    expect(createSecretStore(repo, crypto, { log }).getApiKey()).toBeNull()
    expect(log.lines[0]?.level).toBe('warn')
    expect(log.text()).not.toContain(KEY)
  })

  it('returns null for an encrypted key when encryption is no longer available', () => {
    const repo = memoryRepo()
    const { crypto, state } = fakeCrypto()
    createSecretStore(repo, crypto).setApiKey(KEY)
    state.available = false
    expect(createSecretStore(repo, crypto).getApiKey()).toBeNull()
  })

  it('ignores blobs with an unknown header', () => {
    const repo = memoryRepo()
    repo.setSecret(API_KEY_SECRET, Buffer.from([0x7f, 1, 2, 3]))
    expect(createSecretStore(repo, fakeCrypto().crypto).getApiKey()).toBeNull()
  })
})
