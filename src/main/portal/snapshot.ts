import { z } from 'zod'

/**
 * What the AI sees of a portal page: its address, headings, a slice of its text and a numbered list
 * of the things that can be clicked. Built inside the page by SNAPSHOT_SCRIPT (also walking open
 * shadow roots, which Brightspace's components use, and same-origin frames); clicks go by number.
 */

export interface PageElement {
  id: number
  kind: 'link' | 'button' | 'menuitem' | 'tab' | 'expander' | 'submit'
  label: string
  /** Absolute URL for links. */
  href: string | null
  /** aria-expanded, for folders and modules that open in place. */
  expanded: boolean | null
}

export interface PageSnapshot {
  url: string
  title: string
  headings: string[]
  text: string
  elements: PageElement[]
}

/** The script's result, checked as untrusted data (it was built inside a web page). */
export const pageSnapshotSchema = z.object({
  url: z.string().max(4000),
  title: z.string().max(1000),
  headings: z.array(z.string().max(500)).max(50),
  text: z.string().max(5000),
  elements: z
    .array(
      z.object({
        id: z.number().int().min(0),
        kind: z.enum(['link', 'button', 'menuitem', 'tab', 'expander', 'submit']),
        label: z.string().max(500),
        href: z.string().max(4000).nullable(),
        expanded: z.boolean().nullable()
      })
    )
    .max(1000)
})

/** Cap on listed elements: enough for a module page, small enough for a fast model call. */
export const MAX_ELEMENTS = 250

/**
 * Runs in the page (executeJavaScript). Elements are kept in window.__sbEls so CLICK_SCRIPT can
 * press one by its number. Read-only otherwise: it changes nothing on the page.
 */
export const SNAPSHOT_SCRIPT = `(() => {
  const MAX = ${MAX_ELEMENTS};
  const out = [];
  const els = [];
  const headings = [];
  const seen = new Set();
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 140);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const labelOf = (el) => {
    const host = el.getRootNode() && el.getRootNode().host;
    return clean(
      el.getAttribute('aria-label') || el.getAttribute('text') || el.innerText || el.getAttribute('title') ||
      (el.querySelector && el.querySelector('img[alt]') && el.querySelector('img[alt]').getAttribute('alt')) ||
      (host && (host.getAttribute('text') || host.getAttribute('aria-label') || host.innerText)) || ''
    );
  };
  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if ((tag === 'button' || tag === 'input') && (el.type === 'submit') && el.form) return 'submit';
    if (el.hasAttribute('aria-expanded') || tag === 'summary') return 'expander';
    if (role === 'menuitem' || tag.includes('menu-item')) return 'menuitem';
    if (role === 'tab') return 'tab';
    if (tag === 'a' || role === 'link') return 'link';
    return 'button';
  };
  const actionable = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href');
    if (tag === 'button' || tag === 'summary') return true;
    if (tag === 'input') return ['button', 'submit'].includes(el.type);
    const role = el.getAttribute('role');
    if (['button', 'link', 'menuitem', 'tab', 'treeitem'].includes(role || '')) return true;
    return tag.includes('-') && /button|menu-item|link/.test(tag) && !el.shadowRoot?.querySelector('button, a[href]');
  };
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (out.length >= MAX) return;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-3]$/.test(tag) && headings.length < 30) { const h = clean(el.innerText); if (h) headings.push(h); }
      if (actionable(el) && !seen.has(el) && visible(el)) {
        const label = labelOf(el);
        if (label) {
          seen.add(el);
          els.push(el);
          const exp = el.getAttribute('aria-expanded');
          out.push({ id: els.length - 1, kind: kindOf(el), label, href: tag === 'a' ? el.href : null,
            expanded: exp === null ? null : exp === 'true' });
        }
      }
      if (el.shadowRoot) walk(el.shadowRoot);
      if (tag === 'iframe') { try { if (el.contentDocument) walk(el.contentDocument); } catch (e) {} }
    }
  };
  walk(document);
  window.__sbEls = els;
  return { url: location.href, title: document.title, headings, text: clean(document.body ? document.body.innerText : '').slice(0, 1500) || '', elements: out };
})()`

/** Presses element `id` of the last snapshot; false when it is gone. */
export const clickScript = (id: number): string =>
  `(() => { const el = (window.__sbEls || [])[${Math.trunc(id)}]; if (!el || !el.isConnected) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`

/** Labels the AI may never press: they change the student's account or course, not just the view. */
const FORBIDDEN =
  /\b(delete|remove|unenrol|unenroll|withdraw|drop course|submit|sign ?out|log ?out|send|post|reply|publish|pay|purchase|archive|reset|discard|mark as complete|subscribe|unsubscribe|email|message)\b/i

/** Second-level labels that act as public suffixes under country domains ("ac.uk", "com.au"). */
const SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org', 'sch', 'nhs', 'go', 'or', 'ne'])

/** The registrable part of a host, roughly ("learn.ul.ie" → "ul.ie", "cs.ox.ac.uk" → "ox.ac.uk"). */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().split('.')
  if (parts.length <= 2) return parts.join('.')
  const country = (parts.at(-1)?.length ?? 0) === 2
  return parts.slice(country && SECOND_LEVEL.has(parts.at(-2) ?? '') ? -3 : -2).join('.')
}

/** Whether the AI may press `el` on a page of `pageUrl`; a reason when not. */
export function allowedClick(el: PageElement, pageUrl: string): { ok: true } | { ok: false; reason: string } {
  if (el.kind === 'submit') return { ok: false, reason: 'it submits a form' }
  if (FORBIDDEN.test(el.label))
    return { ok: false, reason: `"${el.label}" could change your account or course` }
  if (el.href) {
    let target: URL
    try {
      target = new URL(el.href)
    } catch {
      return { ok: false, reason: 'its address is not valid' }
    }
    if (target.protocol === 'javascript:') return { ok: true }
    if (target.protocol !== 'https:' && target.protocol !== 'http:')
      return { ok: false, reason: 'it is not a web link' }
    let page: URL
    try {
      page = new URL(pageUrl)
    } catch {
      return { ok: true }
    }
    if (siteOf(target.hostname) !== siteOf(page.hostname))
      return { ok: false, reason: `it leaves the portal (${target.hostname})` }
  }
  return { ok: true }
}

/** The snapshot as the model reads it: one line per element. */
export function describeSnapshot(page: PageSnapshot): string {
  const lines = page.elements.map((e) => {
    const extra = [
      e.kind,
      e.expanded === null ? null : e.expanded ? 'expanded' : 'collapsed',
      e.href ? e.href.replace(/^https?:\/\/[^/]+/, '') : null
    ]
      .filter(Boolean)
      .join(', ')
    return `[${e.id}] ${e.label} (${extra})`
  })
  return [
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    page.headings.length > 0 ? `Headings: ${page.headings.join(' | ')}` : null,
    `Text: ${page.text}`,
    'Elements:',
    ...lines
  ]
    .filter((l) => l !== null)
    .join('\n')
}
