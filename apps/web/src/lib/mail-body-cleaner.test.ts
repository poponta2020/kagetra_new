import { describe, it, expect } from 'vitest'
import { buildBroadcastBody, stripMailFooter } from './mail-body-cleaner'

describe('stripMailFooter', () => {
  it('returns body unchanged when no Google Groups footer is present', () => {
    const body = 'こんにちは\n本文本文\n署名 太郎'
    expect(stripMailFooter(body)).toBe('こんにちは\n本文本文\n署名 太郎')
  })

  it('strips Japanese Google Groups footer after `-- \\n`', () => {
    const body = [
      'こんにちは',
      '本文本文',
      '署名 太郎',
      '',
      '-- ',
      'このメールは Google グループ「xxxxx」に登録しているユーザーに送られています。',
      'このグループから退会するには xxxxx+unsubscribe@googlegroups.com にメールを送信してください。',
      'https://groups.google.com/d/msgid/xxxxx/yyyyy にアクセス',
    ].join('\n')
    expect(stripMailFooter(body)).toBe('こんにちは\n本文本文\n署名 太郎')
  })

  it('strips English Google Groups footer after `-- \\n`', () => {
    const body = [
      'Hello',
      'Some body',
      '-- ',
      'You received this message because you are subscribed to the Google Groups "xxx" group.',
      'To unsubscribe...',
    ].join('\n')
    expect(stripMailFooter(body)).toBe('Hello\nSome body')
  })

  it('strips Google Groups footer that appears after a blank line (no `-- `)', () => {
    const body = [
      'こんにちは',
      '本文本文',
      '',
      'このメールは Google グループ「xxx」に登録しているユーザーに送られています。',
      'unsubscribe URL...',
    ].join('\n')
    expect(stripMailFooter(body)).toBe('こんにちは\n本文本文')
  })

  it('keeps a manual signoff that contains `-- ` but is not Google Groups', () => {
    const body = [
      'こんにちは',
      '本文本文',
      '',
      '-- ',
      '主催者 山田太郎',
      'メール: yamada@example.com',
    ].join('\n')
    // Google Groups パターンに一致しないので削除されない
    expect(stripMailFooter(body)).toBe(body)
  })

  it('trims trailing whitespace even when no footer matched', () => {
    const body = 'こんにちは\n本文本文\n\n\n'
    expect(stripMailFooter(body)).toBe('こんにちは\n本文本文')
  })

  it('handles CRLF line endings', () => {
    const body =
      'こんにちは\r\n本文本文\r\n\r\n-- \r\nこのメールは Google グループ「x」に登録しているユーザーに送られています。\r\nfooter'
    expect(stripMailFooter(body)).toBe('こんにちは\r\n本文本文')
  })
})

describe('buildBroadcastBody', () => {
  it('prepends 【メール件名】 prefix when subject is present', () => {
    const result = buildBroadcastBody({
      rawBody: '本文です',
      subject: '第48回大会のお知らせ',
      isCorrection: false,
    })
    expect(result).toBe('【メール件名】第48回大会のお知らせ\n\n本文です')
  })

  it('omits subject prefix when subject is empty/null', () => {
    expect(
      buildBroadcastBody({ rawBody: '本文だけ', subject: '', isCorrection: false }),
    ).toBe('本文だけ')
    expect(
      buildBroadcastBody({ rawBody: '本文だけ', subject: null, isCorrection: false }),
    ).toBe('本文だけ')
  })

  it('prepends 【訂正】「<件名>」 + subject prefix for corrections', () => {
    const result = buildBroadcastBody({
      rawBody: '訂正後本文',
      subject: '第48回大会のお知らせ(訂正版)',
      isCorrection: true,
    })
    expect(result).toBe(
      '【訂正】「第48回大会のお知らせ(訂正版)」\n【メール件名】第48回大会のお知らせ(訂正版)\n\n訂正後本文',
    )
  })

  it('correction without subject still shows 【訂正】 alone', () => {
    expect(
      buildBroadcastBody({ rawBody: '本文', subject: null, isCorrection: true }),
    ).toBe('【訂正】\n本文')
  })

  it('cleans Google Groups footer before composing', () => {
    const result = buildBroadcastBody({
      rawBody: '本文\n\n-- \nこのメールは Google グループ「x」に登録しているユーザーに送られています。\nfooter',
      subject: 'テスト',
      isCorrection: false,
    })
    expect(result).toBe('【メール件名】テスト\n\n本文')
  })

  it('falls back to placeholder body when rawBody is empty', () => {
    const result = buildBroadcastBody({
      rawBody: null,
      subject: 'タイトル',
      isCorrection: false,
    })
    expect(result).toBe('【メール件名】タイトル\n\n(本文なし)')
  })

  it('trims surrounding whitespace from subject', () => {
    const result = buildBroadcastBody({
      rawBody: '本文',
      subject: '  前後空白  ',
      isCorrection: false,
    })
    expect(result).toBe('【メール件名】前後空白\n\n本文')
  })
})
