import type { Card, CardType } from '@shared/domain'
import { cx, Markdown } from '../../components'
import { hasCloze } from './cloze'
import { ClozeText } from './ClozeText'

export const cardTypeLabel: Record<CardType, string> = {
  basic: 'Question',
  cloze: 'Fill the gap',
  formula: 'Formula',
  contrast: 'Compare',
  why: 'Why & how',
  mistake: 'My mistake'
}

interface CardBodyProps {
  card: Card
  flipped: boolean
  size?: 'sm' | 'lg'
}

/**
 * A flashcard's content. Basic cards show the back under a fold line once flipped. Cloze cards
 * reveal in place (blanks become highlighted answers, nothing above moves) and put the back's
 * extra note under the fold.
 */
export function CardBody({ card, flipped, size = 'sm' }: CardBodyProps): React.JSX.Element {
  const lg = size === 'lg'
  const main = lg ? 'text-xl leading-[1.55]' : 'text-md'
  const cloze = card.type === 'cloze' || hasCloze(card.front)
  const note = card.back.trim()
  const fold = cx('border-t border-dashed border-rule-strong', lg ? 'pt-6' : 'pt-3')
  return (
    <div className={cx('flex flex-col', lg ? 'gap-6' : 'gap-3')}>
      {cloze ? (
        <ClozeText text={card.front} reveal={flipped} className={main} />
      ) : (
        <Markdown className={main}>{card.front}</Markdown>
      )}
      {flipped && (!cloze || note) ? (
        <div data-side="back" className={fold}>
          <Markdown className={cloze ? cx('text-graphite', lg ? 'text-md' : 'text-sm') : main}>
            {cloze ? note : card.back}
          </Markdown>
        </div>
      ) : null}
    </div>
  )
}
