import { eq } from 'drizzle-orm'
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@shared/settings'
import { iso, type RepoContext } from '../context'
import { secrets, settings } from '../schema'
import type { SettingsRepo } from '../types'

/** Row holding the user's overrides. Only changed keys are stored, so new defaults reach everyone else. */
const KEY = 'app'

type Overrides = Record<string, unknown>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Nested objects (e.g. `models`) merge key by key; everything else is replaced. */
function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const prev = out[key]
    out[key] = isPlainObject(prev) && isPlainObject(value) ? deepMerge(prev, value) : value
  }
  return out
}

/**
 * Stored overrides merged over DEFAULT_SETTINGS, validated per top-level key: one invalid or obsolete
 * stored value (e.g. after a schema change) falls back to its default instead of resetting everything
 * or crashing the app at startup.
 */
export function resolveSettings(stored: Overrides): Settings {
  const merged = deepMerge({ ...DEFAULT_SETTINGS }, stored)
  const shape = settingsSchema.shape
  const candidate: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    if (shape[key].safeParse(merged[key]).success) candidate[key] = merged[key]
  }
  return settingsSchema.parse(candidate)
}

export function createSettingsRepo(ctx: RepoContext): SettingsRepo {
  const { db } = ctx

  const readOverrides = (): Overrides =>
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get()?.value ?? {}

  return {
    get() {
      return resolveSettings(readOverrides())
    },

    update(patch) {
      // Throws a ZodError for invalid input: callers (IPC) validate first, this is the last line.
      const valid = settingsSchema.partial().parse(patch)
      return ctx.tx(() => {
        const next = deepMerge(readOverrides(), valid)
        db.insert(settings)
          .values({ key: KEY, value: next })
          .onConflictDoUpdate({ target: settings.key, set: { value: next } })
          .run()
        return resolveSettings(next)
      })
    },

    getSecret(name) {
      const row = db.select({ value: secrets.value }).from(secrets).where(eq(secrets.name, name)).get()
      return row ? Buffer.from(row.value) : null
    },

    setSecret(name, value) {
      if (value === null) {
        db.delete(secrets).where(eq(secrets.name, name)).run()
        return
      }
      const row = { value: Buffer.from(value), updatedAt: iso(ctx.now()) }
      db.insert(secrets)
        .values({ name, ...row })
        .onConflictDoUpdate({ target: secrets.name, set: row })
        .run()
    }
  }
}
