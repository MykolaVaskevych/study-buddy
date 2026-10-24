import {
  becameDownload,
  browserUserAgent,
  downloadTarget,
  isWebUrl,
  normaliseAddress,
  safeFileName
} from './policy'

describe('portal policy', () => {
  it('turns what the student types into a web address', () => {
    expect(normaliseAddress('sulis.ul.ie')).toBe('https://sulis.ul.ie/')
    expect(normaliseAddress(' https://learn.ul.ie/d2l/home ')).toBe('https://learn.ul.ie/d2l/home')
    expect(normaliseAddress('http://localhost:8080/x')).toBe('http://localhost:8080/x')
    expect(normaliseAddress('blackboard')).toBeNull()
    expect(normaliseAddress('file:///etc/passwd')).toBeNull()
    expect(normaliseAddress('javascript:alert(1)')).toBeNull()
    expect(normaliseAddress('two words.com')).toBeNull()
  })

  it('shows only web pages', () => {
    expect(isWebUrl('https://x.org/a')).toBe(true)
    expect(isWebUrl('file:///tmp/a.html')).toBe(false)
    expect(isWebUrl('sb-pdf://doc')).toBe(false)
  })

  it('imports study files and saves the rest', () => {
    expect(downloadTarget('Week 5.pptx')).toBe('import')
    expect(downloadTarget('notes.PDF')).toBe('import')
    expect(downloadTarget('all-files.zip')).toBe('save')
  })

  it('looks like Chrome to sign-in pages', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) study-buddy/0.1.0 Chrome/146.0.0.0 Electron/44.9.0 Safari/537.36'
    expect(browserUserAgent(ua)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
    )
  })

  it('keeps downloaded file names inside their folder', () => {
    expect(safeFileName('../../evil.pdf')).toBe('.._.._evil.pdf')
    expect(safeFileName('Week 5: Spark.pptx')).toBe('Week 5_ Spark.pptx')
    expect(safeFileName('..')).toBe('download')
  })

  it('tells a link that turned into a download from a page that failed', () => {
    expect(becameDownload('https://x.edu/w5.pdf', 'https://x.edu/w5.pdf')).toBe(true)
    expect(becameDownload('https://x.edu/d2l/topic/9', 'https://x.edu/content/signed/w5.pdf?t=1')).toBe(true)
    expect(becameDownload('https://x.edu/page', null)).toBe(false)
    expect(becameDownload('https://x.edu/page', 'https://cdn.other.com/a.pdf')).toBe(false)
  })
})
