import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  decideNavigation,
  isAppUrl,
  isExternalWebUrl,
  resolveRendererSource,
  type RendererSource
} from './url-policy'

const INDEX = '/opt/study-buddy/out/renderer/index.html'
const file: RendererSource = { kind: 'file', path: INDEX }
const dev: RendererSource = { kind: 'url', url: 'http://localhost:5173' }
const indexUrl = pathToFileURL(INDEX).href

describe('resolveRendererSource', () => {
  it('prefers the dev server URL', () => {
    expect(resolveRendererSource('http://localhost:5173', INDEX)).toEqual(dev)
    expect(resolveRendererSource(undefined, INDEX)).toEqual(file)
    expect(resolveRendererSource('', INDEX)).toEqual(file)
  })
})

describe('isAppUrl', () => {
  it.each([
    [`${indexUrl}`, true],
    [`${indexUrl}#/book/doc-1?page=3`, true],
    [pathToFileURL('/opt/study-buddy/out/renderer/assets/index.js').href, true],
    [pathToFileURL('/opt/study-buddy/out/main/index.js').href, false],
    ['file:///opt/study-buddy/out/renderer/../main/index.js', false],
    ['file:///etc/passwd', false],
    ['file://evil-host/opt/study-buddy/out/renderer/index.html', false],
    ['http://localhost:5173/', false],
    ['not a url', false]
  ])('built renderer: %s -> %s', (url, expected) => {
    expect(isAppUrl(file, url)).toBe(expected)
  })

  it.each([
    ['http://localhost:5173/', true],
    ['http://localhost:5173/#/library', true],
    ['http://localhost:5174/', false],
    ['https://localhost:5173/', false],
    ['http://127.0.0.1:5173/', false],
    [indexUrl, false]
  ])('dev server: %s -> %s', (url, expected) => {
    expect(isAppUrl(dev, url)).toBe(expected)
  })

  it('never trusts an opaque dev origin', () => {
    expect(isAppUrl({ kind: 'url', url: 'data:text/html,hi' }, 'data:text/html,hi')).toBe(false)
  })
})

describe('external links', () => {
  it.each([
    ['https://en.wikipedia.org/wiki/Nyquist_rate', true],
    ['http://example.com', true],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['mailto:someone@example.com', false],
    ['sb-pdf://doc/x', false],
    ['', false]
  ])('%s -> %s', (url, expected) => {
    expect(isExternalWebUrl(url)).toBe(expected)
  })

  it('decides in-window navigation', () => {
    expect(decideNavigation(file, `${indexUrl}#/settings`)).toBe('allow')
    expect(decideNavigation(file, 'https://example.com/')).toBe('open-external')
    expect(decideNavigation(file, 'file:///home/me/notes.html')).toBe('deny')
    expect(decideNavigation(dev, 'http://localhost:5173/#/x')).toBe('allow')
  })
})
