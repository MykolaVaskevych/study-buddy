import { strToU8, zipSync } from 'fflate'
import { pptxNotes } from './pptx-notes'
import { withNotes } from './index'

const notesSlide = (text: string): string =>
  `<?xml version="1.0"?><p:notes xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${text}</p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:notes>`

/** A minimal deck: slide2.xml is shown first, slide1.xml second; only slide1 has notes on its 2 lines. */
export function makePptx(): Uint8Array {
  return zipSync({
    'ppt/presentation.xml': strToU8(
      '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId7"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>'
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId3" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId7" Type="slide" Target="slides/slide2.xml"/></Relationships>'
    ),
    'ppt/slides/slide1.xml': strToU8('<p:sld/>'),
    'ppt/slides/slide2.xml': strToU8('<p:sld/>'),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Type="notesSlide" Target="../notesSlides/notesSlide4.xml"/></Relationships>'
    ),
    'ppt/slides/_rels/slide2.xml.rels': strToU8('<Relationships></Relationships>'),
    'ppt/notesSlides/notesSlide4.xml': strToU8(
      notesSlide(
        '<a:p><a:r><a:t>Exam favourite: </a:t></a:r><a:r><a:t>MapReduce &amp; shuffle</a:t></a:r></a:p><a:p><a:r><a:t>Know the combiner.</a:t></a:r></a:p>'
      )
    )
  })
}

describe('pptx speaker notes', () => {
  it('reads the body notes per slide in show order, without the slide number', () => {
    expect(pptxNotes(makePptx())).toEqual(['', 'Exam favourite: MapReduce & shuffle\nKnow the combiner.'])
  })

  it('gives no notes for a file that is not a deck', () => {
    expect(pptxNotes(new Uint8Array([1, 2, 3]))).toEqual([])
  })

  it('appends notes to the matching page text', () => {
    const page = (n: number, text: string) => ({
      page: n,
      label: null,
      text,
      charCount: text.length,
      hasTextLayer: text !== ''
    })
    const pages = withNotes([page(1, 'Title'), page(2, '')], ['Say hello', 'Image-only slide explained'])
    expect(pages[0]?.text).toBe('Title\n\nSpeaker notes: Say hello')
    expect(pages[1]).toMatchObject({ text: 'Speaker notes: Image-only slide explained', hasTextLayer: false })
  })
})
