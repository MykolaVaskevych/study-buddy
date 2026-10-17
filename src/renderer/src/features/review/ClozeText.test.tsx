import { render, screen } from '@testing-library/react'
import type { Card } from '@shared/domain'
import { CardBody } from './CardFace'
import { ClozeText } from './ClozeText'

const text =
  'Rayleigh scattering falls as {{c1::$\\lambda^{-4}$}}, which favours {{c2::longer::shorter or longer?}} wavelengths.'

describe('ClozeText', () => {
  it('shows blanks (with hints) on the front and hides the answers', () => {
    const { container } = render(<ClozeText text={text} reveal={false} />)
    const gaps = container.querySelectorAll('[data-cloze="gap"]')
    expect(gaps).toHaveLength(2)
    expect(gaps[1]?.textContent).toContain('shorter or longer?')
    expect(screen.getAllByText(/^blank/)).toHaveLength(2)
    // The math answer is not rendered anywhere on the front.
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.textContent).toContain('falls as ')
    expect(container.textContent).toContain(', which favours ')
  })

  it('highlights the answers on the back, math included', () => {
    const { container } = render(<ClozeText text={text} reveal />)
    const marks = container.querySelectorAll('mark[data-cloze="answer"]')
    expect(marks).toHaveLength(2)
    expect(marks[0]?.querySelector('.katex')).not.toBeNull()
    expect(marks[1]?.textContent).toBe('longer')
    expect(marks[0]?.className).toContain('marker-stroke')
    expect(container.querySelector('[data-cloze="gap"]')).toBeNull()
  })

  it('reveals cloze cards in place and adds the note under the fold', () => {
    const card = {
      id: 'c',
      type: 'cloze',
      front: 'Margin of {{c1::3 to 6 dB}}.',
      back: 'Subtracted like a loss.'
    } as Card
    const { container, rerender } = render(<CardBody card={card} flipped={false} />)
    expect(container.querySelector('[data-side="back"]')).toBeNull()
    rerender(<CardBody card={card} flipped />)
    expect(container.querySelector('mark')?.textContent).toBe('3 to 6 dB')
    expect(container.querySelector('[data-side="back"]')?.textContent).toBe('Subtracted like a loss.')
    // The cloze text is shown once, not repeated on the back.
    expect(container.textContent?.match(/Margin of/g)).toHaveLength(1)
  })
})
