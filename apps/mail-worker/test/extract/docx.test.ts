import { describe, expect, it } from 'vitest'
import { extractDocxText } from '../../src/extract/docx.js'
import { buildMinimalDocx } from '../fixtures/attachments/builders.js'

describe('extractDocxText', () => {
  it('extracts the body paragraph text from a minimal docx', async () => {
    const buffer = await buildMinimalDocx('PR2 docx body')
    const text = await extractDocxText(buffer)
    expect(text).toBe('PR2 docx body')
  })

  it('throws on a non-docx buffer — orchestrator catches this and marks failed', async () => {
    const garbage = Buffer.from('PK not really a docx')
    await expect(extractDocxText(garbage)).rejects.toThrow()
  })
})
