import { describe, expect, it } from 'vitest'
import {
  attachmentTypeLabel,
  formatAttachmentMeta,
  formatHistoryDate,
  formatHistorySummaryDate,
  formatMailDetailDateTime,
  formatMailListDateTime,
} from './format'

// design-mock/detail-a-timeline.html ①: 2026-08-01 21:07 JST（土曜）
const AUG1_2107_JST = new Date('2026-08-01T12:07:00Z')
// design-mock/list-normal.html ①: 2026-08-08 16:25 JST（土曜）
const AUG8_1625_JST = new Date('2026-08-08T07:25:00Z')
// design-mock 履歴の日付見出し例: 2026-08-02（時刻はダミー）
const AUG2_JST = new Date('2026-08-02T03:00:00Z')
// design-mock 一覧サマリ例: 2026-08-04（時刻はダミー）
const AUG4_JST = new Date('2026-08-04T03:00:00Z')

describe('formatMailListDateTime', () => {
  it('モックどおり `8/8(土) 16:25`', () => {
    expect(formatMailListDateTime(AUG8_1625_JST)).toBe('8/8(土) 16:25')
  })
})

describe('formatMailDetailDateTime', () => {
  it('モックどおり `2026年8月1日(土) 21:07`', () => {
    expect(formatMailDetailDateTime(AUG1_2107_JST)).toBe('2026年8月1日(土) 21:07')
  })
})

describe('formatHistoryDate', () => {
  it('モックどおり `2026年8月2日`', () => {
    expect(formatHistoryDate(AUG2_JST)).toBe('2026年8月2日')
  })
})

describe('formatHistorySummaryDate', () => {
  it('モックどおり `8/4`', () => {
    expect(formatHistorySummaryDate(AUG4_JST)).toBe('8/4')
  })
})

describe('TZ 非依存（JST 固定）', () => {
  it('UTC 15:00 は翌日 0:00 JST になる（process.env.TZ に依存しない）', () => {
    // UTC 15:00 = JST 翌日 00:00（+9h）。ホストの TZ 設定に関わらずこの結果になること。
    const d = new Date('2026-08-08T15:00:00Z')
    expect(formatMailListDateTime(d)).toBe('8/9(日) 00:00')
    expect(formatMailDetailDateTime(d)).toBe('2026年8月9日(日) 00:00')
    expect(formatHistoryDate(d)).toBe('2026年8月9日')
    expect(formatHistorySummaryDate(d)).toBe('8/9')
  })
})

describe('attachmentTypeLabel', () => {
  it('content_type から判定する（PDF/Word/Excel/PowerPoint/画像/ZIP/テキスト）', () => {
    expect(attachmentTypeLabel('application/pdf', 'x')).toBe('PDF')
    expect(
      attachmentTypeLabel(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'x',
      ),
    ).toBe('Word')
    expect(
      attachmentTypeLabel(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'x',
      ),
    ).toBe('Excel')
    expect(
      attachmentTypeLabel(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'x',
      ),
    ).toBe('PowerPoint')
    expect(attachmentTypeLabel('image/jpeg', 'x')).toBe('画像')
    expect(attachmentTypeLabel('application/zip', 'x')).toBe('ZIP')
    expect(attachmentTypeLabel('text/plain', 'x')).toBe('テキスト')
  })

  it('content_type が汎用（application/octet-stream 等）のときは拡張子で判定する', () => {
    expect(attachmentTypeLabel('application/octet-stream', 'file.pdf')).toBe('PDF')
    expect(attachmentTypeLabel('application/octet-stream', 'file.docx')).toBe('Word')
    expect(attachmentTypeLabel('application/octet-stream', 'file.xlsx')).toBe('Excel')
    expect(attachmentTypeLabel('application/octet-stream', 'file.pptx')).toBe('PowerPoint')
    expect(attachmentTypeLabel('application/octet-stream', 'file.jpg')).toBe('画像')
    expect(attachmentTypeLabel('application/octet-stream', 'file.zip')).toBe('ZIP')
    expect(attachmentTypeLabel('application/octet-stream', 'file.csv')).toBe('テキスト')
  })

  it('どちらでも判定できなければ `ファイル`', () => {
    expect(attachmentTypeLabel('application/octet-stream', 'file.unknown')).toBe('ファイル')
  })
})

describe('formatAttachmentMeta', () => {
  it('モックどおりの表記（種別 · サイズ）', () => {
    expect(formatAttachmentMeta('application/pdf', '要項.pdf', 1_258_291)).toBe(
      'PDF · 1.2 MB',
    )
    expect(
      formatAttachmentMeta(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '申込書.docx',
        49_152,
      ),
    ).toBe('Word · 48 KB')
    expect(
      formatAttachmentMeta(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '名簿.xlsx',
        86_016,
      ),
    ).toBe('Excel · 84 KB')
    expect(formatAttachmentMeta('image/jpeg', '会場図.jpg', 2_202_010)).toBe(
      '画像 · 2.1 MB',
    )
    expect(formatAttachmentMeta('application/zip', '一式.zip', 5_033_164)).toBe(
      'ZIP · 4.8 MB',
    )
  })

  // 送信者のメーラーが application/octet-stream で送ってくる添付は実在する。
  // content_type だけで判定すると「ファイル · …」に劣化するので、拡張子まで
  // フォールバックすることを固定する。
  it('content_type が octet-stream でも拡張子で種別を判定する', () => {
    expect(
      formatAttachmentMeta('application/octet-stream', '組合せ表一式.zip', 5_033_164),
    ).toBe('ZIP · 4.8 MB')
    expect(
      formatAttachmentMeta('application/octet-stream', '第46回九段大会要項.pdf', 1_258_291),
    ).toBe('PDF · 1.2 MB')
  })

  it('サイズ境界: 1023 B / 1024 B / 1 MB 直前 / 1 MB', () => {
    expect(formatAttachmentMeta('application/pdf', 'a.pdf', 1023)).toBe('PDF · 1023 B')
    expect(formatAttachmentMeta('application/pdf', 'a.pdf', 1024)).toBe('PDF · 1 KB')
    // 「1 MB 直前」= 1000 KB（丸め誤差のない値で確認する）
    expect(formatAttachmentMeta('application/pdf', 'a.pdf', 1000 * 1024)).toBe(
      'PDF · 1000 KB',
    )
    expect(formatAttachmentMeta('application/pdf', 'a.pdf', 1024 * 1024)).toBe(
      'PDF · 1.0 MB',
    )
  })
})
