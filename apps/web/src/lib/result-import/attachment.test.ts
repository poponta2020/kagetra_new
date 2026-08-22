import { describe, expect, it } from 'vitest'
import { isResultImportAttachment } from './attachment'

describe('isResultImportAttachment', () => {
  it('.xlsx を受け付ける', () => {
    expect(isResultImportAttachment('result.xlsx')).toBe(true)
  })

  it('.xls を受け付ける', () => {
    expect(isResultImportAttachment('result.xls')).toBe(true)
  })

  it('.pdf を受け付ける', () => {
    expect(isResultImportAttachment('result.pdf')).toBe(true)
  })

  it('大文字の拡張子も受け付ける', () => {
    expect(isResultImportAttachment('RESULT.PDF')).toBe(true)
    expect(isResultImportAttachment('RESULT.XLSX')).toBe(true)
  })

  it('対象外の拡張子は拒否する', () => {
    expect(isResultImportAttachment('document.docx')).toBe(false)
    expect(isResultImportAttachment('image.png')).toBe(false)
    expect(isResultImportAttachment('notes.txt')).toBe(false)
  })
})
