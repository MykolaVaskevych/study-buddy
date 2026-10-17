import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { findCitations } from './citations'
import { Markdown, safeUrl } from './Markdown'

describe('Markdown', () => {
  it('never renders raw HTML', () => {
    const { container } = render(
      <Markdown>{'Hello <script>alert(1)</script> <img src=x onerror="alert(2)"> <b>bold</b>'}</Markdown>
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<script>')
  })

  it('turns [p. 12] into a citation button', async () => {
    const onCitation = vi.fn()
    render(<Markdown onCitation={onCitation}>{'See the budget [p. 12] and [pp. 3–5].'}</Markdown>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go to page 12' }))
    expect(onCitation).toHaveBeenCalledWith(12)
    expect(screen.getByRole('button', { name: 'Go to pages 3 to 5' })).toBeTruthy()
  })

  it('keeps http(s) links and drops other schemes', () => {
    render(
      <Markdown>{'[ok](https://example.com) [bad](javascript:alert(1)) [file](file:///etc/passwd)'}</Markdown>
    )
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/')
    expect(links[0]?.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('bad').tagName).toBe('SPAN')
  })

  it('renders math with KaTeX', () => {
    const { container } = render(<Markdown>{'Loss is $P_{rx} = P_{tx} - \\alpha L$.'}</Markdown>)
    expect(container.querySelector('.katex')).not.toBeNull()
  })
})

describe('findCitations', () => {
  it('finds single pages and ranges', () => {
    expect(findCitations('a [p. 7] b [p.8] c [pp. 9-11]').map((c) => [c.page, c.pageEnd])).toEqual([
      [7, null],
      [8, null],
      [9, 11]
    ])
  })
  it('ignores page 0 and plain brackets', () => {
    expect(findCitations('[p. 0] [12] [page 3]')).toEqual([])
  })
})

describe('safeUrl', () => {
  it.each([
    ['https://a.b/c', 'https://a.b/c'],
    ['http://a.b/', 'http://a.b/'],
    ['javascript:alert(1)', ''],
    ['sb-pdf://doc/x', ''],
    ['/relative', '']
  ])('%s -> %s', (input, out) => expect(safeUrl(input)).toBe(out))
})
