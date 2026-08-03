import { describe, expect, it } from 'vitest'
import {
  buildAttachmentFlexMessage,
  fileBadge,
  formatFileSize,
} from './line-flex-attachment'

describe('fileBadge', () => {
  it('Excel 系 (xlsx/xls/xlsm/csv) は緑バッジ + 拡張子ラベル', () => {
    expect(fileBadge('確定名簿.xlsx')).toEqual({ label: 'XLSX', color: '#217346' })
    expect(fileBadge('meibo.XLS')).toEqual({ label: 'XLS', color: '#217346' })
    expect(fileBadge('list.csv')).toEqual({ label: 'CSV', color: '#217346' })
  })

  it('PDF は赤、Word は青', () => {
    expect(fileBadge('要項.pdf')).toEqual({ label: 'PDF', color: '#D93025' })
    expect(fileBadge('案内.docx')).toEqual({ label: 'DOCX', color: '#2B579A' })
    expect(fileBadge('旧案内.doc')).toEqual({ label: 'DOC', color: '#2B579A' })
  })

  it('その他はグレーで拡張子を大文字化、拡張子なし/長すぎは FILE', () => {
    expect(fileBadge('archive.zip')).toEqual({ label: 'ZIP', color: '#64707D' })
    expect(fileBadge('README')).toEqual({ label: 'FILE', color: '#64707D' })
    expect(fileBadge('data.numbers')).toEqual({ label: 'FILE', color: '#64707D' })
  })
})

describe('formatFileSize', () => {
  it('B / KB / MB を桁に応じて切り替える', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(24 * 1024)).toBe('24 KB')
    expect(formatFileSize(1536)).toBe('2 KB')
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('負値・非有限は空文字 (サイズ行を出さない)', () => {
    expect(formatFileSize(-1)).toBe('')
    expect(formatFileSize(Number.NaN)).toBe('')
  })
})

describe('buildAttachmentFlexMessage', () => {
  const url = 'https://example.com/api/line-broadcast/attachments/tok123'

  it('altText は 📎 ファイル名、URL は uri アクションのみに載る', () => {
    const msg = buildAttachmentFlexMessage({
      filename: '確定名簿.xlsx',
      url,
      sizeBytes: 24 * 1024,
    })
    expect(msg.type).toBe('flex')
    expect(msg.altText).toBe('📎 確定名簿.xlsx')

    const json = JSON.stringify(msg.contents)
    expect(json).toContain('"uri":"https://example.com/api/line-broadcast/attachments/tok123"')
    expect(json).toContain('確定名簿.xlsx')
    expect(json).toContain('24 KB・タップして開く')
    expect(json).toContain('#217346')
    // URL がテキストコンポーネントとして露出していない (uri プロパティのみ)。
    expect(json.split(url)).toHaveLength(2)
  })

  it('tag 付きは altText が 📎【tag】ファイル名 になり、カードにもタグ行が入る', () => {
    const msg = buildAttachmentFlexMessage({
      filename: '要項.pdf',
      url,
      sizeBytes: 100,
      tag: '大会要綱',
    })
    expect(msg.altText).toBe('📎【大会要綱】要項.pdf')
    expect(JSON.stringify(msg.contents)).toContain('"text":"大会要綱"')
  })

  it('sizeBytes 省略時はサイズ行を出さず「タップして開く」だけ', () => {
    const msg = buildAttachmentFlexMessage({ filename: 'a.pdf', url })
    const json = JSON.stringify(msg.contents)
    expect(json).toContain('"text":"タップして開く"')
    expect(json).not.toContain('・タップして開く')
  })

  it('altText は LINE 上限の 400 字に切り詰める', () => {
    const longName = `${'あ'.repeat(500)}.pdf`
    const msg = buildAttachmentFlexMessage({ filename: longName, url })
    expect(msg.altText.length).toBe(400)
    expect(msg.altText.startsWith('📎 あ')).toBe(true)
  })
})
