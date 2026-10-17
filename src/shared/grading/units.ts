/**
 * Small unit parser for numeric answers. Pure TS (src/shared).
 *
 * A unit is parsed into a scale factor and base dimensions, e.g. "Gb/s" -> 1e9 x {bit: 1, s: -1},
 * "ps/(nm·km)" -> 1e-6 x {s: 1, m: -2}, "dB/km" -> 1e-3 x {dB: 1, m: -1}. Two units are comparable
 * when their dimensions are equal; the value is then converted by the factor ratio.
 *
 * Deliberate choices:
 * - dB and dBm are distinct base dimensions: dB is a ratio, dBm an absolute level re 1 mW.
 * - bit and byte are distinct dimensions (no x8 conversion): bit/byte confusion is a classic exam
 *   trap, and silently converting would accept exactly the mistake the question tests.
 * - Hz is its own dimension, not 1/s, so "MHz" can never be confused with "Mbit/s".
 * - Everything after the first "/" is the denominator ("ps/nm·km" = ps/(nm·km)), as engineers write it.
 * - Prefixes are case-sensitive (m = milli, M = mega); base names have a few safe case-insensitive
 *   aliases ("hz", "db", "dbm", "w").
 */

export type Dims = Readonly<Record<string, number>>

export interface ParsedUnit {
  factor: number
  dims: Dims
  /** Canonical dimension key; equal keys = comparable units. */
  key: string
}

interface Atom {
  dims: Dims
  /** Log units take no SI prefix ("mdB" is not a thing). */
  prefixable: boolean
}

const PREFIXES: Readonly<Record<string, number>> = {
  p: 1e-12,
  n: 1e-9,
  µ: 1e-6, // U+00B5 micro sign
  μ: 1e-6, // U+03BC Greek mu
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3, // common in "Kbps"/"KB"; kelvin is not supported, so no ambiguity
  M: 1e6,
  G: 1e9,
  T: 1e12
}

const atom = (dims: Dims, prefixable = true): Atom => ({ dims, prefixable })

const ATOMS: Readonly<Record<string, Atom>> = {
  Hz: atom({ Hz: 1 }),
  bit: atom({ bit: 1 }),
  b: atom({ bit: 1 }),
  bps: atom({ bit: 1, s: -1 }),
  B: atom({ B: 1 }),
  Bps: atom({ B: 1, s: -1 }),
  W: atom({ W: 1 }),
  m: atom({ m: 1 }),
  s: atom({ s: 1 }),
  dB: atom({ dB: 1 }, false),
  dBm: atom({ dBm: 1 }, false)
}

/** Case-insensitive aliases for base names only (never prefixes). */
const LOWER_ALIASES: Readonly<Record<string, Atom>> = {
  hz: atom({ Hz: 1 }),
  bit: atom({ bit: 1 }),
  bits: atom({ bit: 1 }),
  byte: atom({ B: 1 }),
  bytes: atom({ B: 1 }),
  w: atom({ W: 1 }),
  watt: atom({ W: 1 }),
  watts: atom({ W: 1 }),
  sec: atom({ s: 1 }),
  db: atom({ dB: 1 }, false),
  dbm: atom({ dBm: 1 }, false)
}

const SUPERSCRIPT: Readonly<Record<string, number>> = { '²': 2, '³': 3, '⁻¹': -1, '⁻²': -2 }

/** Whitespace and multiplication-sign normalisation, shared with the exact-string fallback. */
export function normaliseUnitText(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    .replace(/[·⋅∙*×]/g, '·')
    .replace(/\s*·\s*/g, '·')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
}

function lookupAtom(token: string): { atom: Atom; factor: number } | null {
  const exact = ATOMS[token]
  if (exact) return { atom: exact, factor: 1 }
  const alias = LOWER_ALIASES[token.toLowerCase()]
  if (alias) return { atom: alias, factor: 1 }
  const prefix = PREFIXES[token.charAt(0)]
  const rest = token.slice(1)
  if (prefix === undefined || rest === '') return null
  const base = ATOMS[rest] ?? LOWER_ALIASES[rest.toLowerCase()]
  return base && base.prefixable ? { atom: base, factor: prefix } : null
}

function parseFactor(token: string): { base: string; exponent: number } | null {
  const sup = /^(.+?)(²|³|⁻¹|⁻²)$/u.exec(token)
  if (sup?.[1] && sup[2]) return { base: sup[1], exponent: SUPERSCRIPT[sup[2]] ?? 1 }
  const caret = /^(.+?)\^\(?(-?\d+)\)?$/.exec(token)
  if (caret?.[1] && caret[2]) return { base: caret[1], exponent: Number(caret[2]) }
  return /^[^\d^]+$/u.test(token) ? { base: token, exponent: 1 } : null
}

/** Parses a unit string; null when it contains anything this parser does not know. */
export function parseUnit(raw: string): ParsedUnit | null {
  const text = normaliseUnitText(raw)
  if (text === '') return null
  const [numerator = '', ...denominators] = text.split('/')
  const dims: Record<string, number> = {}
  let factor = 1
  const parts = [{ text: numerator, sign: 1 }, ...denominators.map((d) => ({ text: d, sign: -1 }))]
  for (const part of parts) {
    const tokens = part.text
      .replace(/[()]/g, '')
      .split(/[·\s]+/)
      .filter(Boolean)
    if (tokens.length === 0) {
      if (part.sign === -1) return null // "W/" is malformed
      continue
    }
    for (const token of tokens) {
      if (token === '1' && part.sign === 1) continue // "1/s"
      const f = parseFactor(token)
      const found = f ? lookupAtom(f.base) : null
      if (!f || !found) return null
      const power = f.exponent * part.sign
      factor *= found.factor ** power
      for (const [dim, exp] of Object.entries(found.atom.dims)) dims[dim] = (dims[dim] ?? 0) + exp * power
    }
  }
  const key = Object.entries(dims)
    .filter(([, e]) => e !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([d, e]) => `${d}^${e}`)
    .join(',')
  if (key === '') return null // e.g. "m/m": not a unit worth comparing
  return { factor, dims, key }
}

export const hasDim = (unit: ParsedUnit, dim: string): boolean => (unit.dims[dim] ?? 0) !== 0
