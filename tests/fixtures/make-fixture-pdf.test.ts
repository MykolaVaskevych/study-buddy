import { PDFDocument } from 'pdf-lib'
import { FIXTURE_PAGES, FIXTURE_TITLE, makeFixturePdf } from './make-fixture-pdf'

describe('fixture pdf', () => {
  it('has the expected pages and title', async () => {
    const doc = await PDFDocument.load(await makeFixturePdf())
    expect(doc.getPageCount()).toBe(FIXTURE_PAGES.lastPage)
    expect(doc.getTitle()).toBe(FIXTURE_TITLE)
  })
})
