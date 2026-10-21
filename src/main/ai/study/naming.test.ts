import type { GenerateRequest, LlmProvider } from '@shared/ai/provider'
import { createFakeProvider } from '../providers/fake/provider'
import { suggestNames } from './naming'

const files = [
  { title: 'lec03_final_v2', pageCount: 30, contents: ['Dispersion', 'PMD'], opening: 'Week 3 Dispersion' },
  { title: 'Notes', pageCount: 12, contents: [], opening: '' }
]

describe('suggestNames', () => {
  it('asks the fast tier with each file listed, and keeps names the model skipped or blanked', async () => {
    const fake = createFakeProvider()
    const requests: GenerateRequest<unknown>[] = []
    const provider: LlmProvider = {
      ...fake,
      async generate<T>(req: GenerateRequest<T>) {
        requests.push(req as GenerateRequest<unknown>)
        const data = {
          course_name: '  Optical   Networks ',
          files: [
            { index: 0, title: 'Week 3: Dispersion and PMD' },
            { index: 1, title: ' ' }
          ]
        }
        return { data: data as T, usage: (await fake.generate(req)).usage, model: 'fake' }
      }
    }
    const result = await suggestNames(provider, { files, language: 'auto' })
    expect(result.value).toEqual({
      course: 'Optical Networks',
      files: ['Week 3: Dispersion and PMD', 'Notes']
    })
    const [request] = requests
    expect(request).toMatchObject({ task: 'naming', tier: 'fast' })
    const text = request?.parts.map((p) => (p.type === 'text' ? p.text : '')).join('') ?? ''
    expect(text).toContain('[0] current name: lec03_final_v2')
    expect(text).toContain('contents: Dispersion; PMD')
    expect(text).toContain('[1] current name: Notes')
  })
})
