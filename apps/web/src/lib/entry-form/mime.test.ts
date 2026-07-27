// @vitest-environment node
// server-only の実体（typeof window !== 'undefined' で throw する）が jsdom
// 環境で読み込まれるとテスト自体が壊れるため、この3ファイルは常に node 環境で
// 走らせる。imapflow / Buffer 系の実挙動を確認するうえでも node の方が適切。
import { describe, it, expect } from 'vitest'
import { buildDraftMime, type DraftMimeInput } from './mime'

/**
 * `Subject: <encoded-word1>\r\n <encoded-word2>\r\n ...` の形から
 * encoded-word だけを1個ずつ取り出す（folding の空白1個は取り除く）。
 */
function extractSubjectEncodedWords(mime: string): string[] {
  const headerBlock = mime.split('\r\n\r\n')[0]!
  const rawLines = headerBlock.split('\r\n')
  const idx = rawLines.findIndex((l) => l.startsWith('Subject: '))
  if (idx === -1) throw new Error('Subject header not found in fixture MIME')
  const words = [rawLines[idx]!.slice('Subject: '.length)]
  let i = idx + 1
  while (i < rawLines.length && rawLines[i]!.startsWith(' ')) {
    words.push(rawLines[i]!.slice(1))
    i++
  }
  return words
}

function decodeEncodedWords(words: string[]): string {
  return words
    .map((word) => {
      const match = word.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/)
      if (!match) throw new Error(`not a valid RFC2047 B-encoded word: ${word}`)
      return Buffer.from(match[1]!, 'base64').toString('utf8')
    })
    .join('')
}

function extractHeaderLine(mime: string, name: string): string {
  const headerBlock = mime.split('\r\n\r\n')[0]!
  const line = headerBlock.split('\r\n').find((l) => l.startsWith(`${name}: `))
  if (!line) throw new Error(`header ${name} not found`)
  return line.slice(name.length + 2)
}

function baseInput(overrides: Partial<DraftMimeInput> = {}): DraftMimeInput {
  return {
    from: 'club@example.co.jp',
    to: 'organizer@example.com',
    subject: '第10回北海道地区高校選手権大会申込み（北海道大学かるた会）',
    bodyText: '担当者様\n\nいつもお世話になっております。\n弊会所属8名分の参加申込書を添付ファイルにてお送りいたします。\nどうぞよろしくお願いいたします。',
    attachment: {
      filename: '【北海道大学かるた会】参加申込書.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255]),
    },
    ...overrides,
  }
}

describe('buildDraftMime', () => {
  it('必須ヘッダ（MIME-Version/Date/Message-ID/From/To/Subject/Content-Type）を出力する', () => {
    const mime = buildDraftMime(baseInput(), {
      boundary: 'FIXED_BOUNDARY',
      date: new Date('2026-07-27T03:04:05.000Z'),
      messageId: '<fixed-id@example.co.jp>',
    })
    expect(extractHeaderLine(mime, 'MIME-Version')).toBe('1.0')
    expect(extractHeaderLine(mime, 'Date')).toBe('Mon, 27 Jul 2026 03:04:05 +0000')
    expect(extractHeaderLine(mime, 'Message-ID')).toBe('<fixed-id@example.co.jp>')
    expect(extractHeaderLine(mime, 'From')).toBe('club@example.co.jp')
    expect(extractHeaderLine(mime, 'To')).toBe('organizer@example.com')
    expect(extractHeaderLine(mime, 'Content-Type')).toBe('multipart/mixed; boundary="FIXED_BOUNDARY"')
  })

  it('boundary/date/messageId を注入した通りに使う（未注入時は自動生成される）', () => {
    const injected = buildDraftMime(baseInput(), {
      boundary: 'MY_BOUNDARY_1',
      date: new Date('2026-01-01T00:00:00.000Z'),
      messageId: '<abc@example.co.jp>',
    })
    expect(injected).toContain('boundary="MY_BOUNDARY_1"')
    expect(injected).toContain('--MY_BOUNDARY_1\r\n')
    expect(injected).toContain('--MY_BOUNDARY_1--')
    expect(extractHeaderLine(injected, 'Message-ID')).toBe('<abc@example.co.jp>')

    const auto = buildDraftMime(baseInput())
    expect(extractHeaderLine(auto, 'Message-ID')).toMatch(/^<\d+\.[0-9a-f]{32}@example\.co\.jp>$/)
  })

  it('boundary の整合性: 開始・パート区切り・終端の3箇所が同一 boundary で揃う', () => {
    const mime = buildDraftMime(baseInput(), { boundary: 'B1' })
    expect(mime).toContain('boundary="B1"')
    const occurrences = mime.split('--B1').length - 1
    // パート1開始 + パート2開始 + 終端(--B1--、これも "--B1" を含む) = 3回
    expect(occurrences).toBe(3)
    expect(mime).toContain('--B1--\r\n')
  })

  it('日本語 Subject が複数の RFC2047 encoded-word に分割され、各語が75文字以内で、連結復号すると元の件名に一致する', () => {
    const subject = '第10回北海道地区高校選手権大会申込み（北海道大学かるた会）とても長い件名のテストケースです'
    const mime = buildDraftMime(baseInput({ subject }))
    const words = extractSubjectEncodedWords(mime)
    expect(words.length).toBeGreaterThan(1)
    for (const word of words) {
      expect(word.length).toBeLessThanOrEqual(75)
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    }
    expect(decodeEncodedWords(words)).toBe(subject)
  })

  it('CRLF のみで構成され、裸の \\n（\\r を伴わない \\n）は存在しない', () => {
    const mime = buildDraftMime(baseInput())
    expect(mime.match(/(?<!\r)\n/)).toBeNull()
  })

  it('base64 添付をデコードすると元の Buffer とバイト一致する', () => {
    const attachmentData = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255, 6, 7, 8, 9])
    const mime = buildDraftMime(baseInput({
      attachment: {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: attachmentData,
      },
    }), { boundary: 'ATTB' })

    const parts = mime.split('--ATTB')
    // parts[0]=ヘッダ, parts[1]=テキストパート, parts[2]=添付パート, parts[3]='--' (終端の残り)
    const attachmentPart = parts[2]!
    const base64Body = attachmentPart
      .slice(attachmentPart.indexOf('\r\n\r\n') + 4)
      .replace(/\r\n$/, '')
      .replace(/\r\n/g, '')
    const decoded = Buffer.from(base64Body, 'base64')
    expect(decoded.equals(attachmentData)).toBe(true)
  })

  it('base64 添付は76文字ごとに折り返される（1行に収まらない長さの場合）', () => {
    const attachmentData = Buffer.alloc(200, 0xab)
    const mime = buildDraftMime(baseInput({
      attachment: {
        filename: 'big.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: attachmentData,
      },
    }), { boundary: 'WRAP' })
    const parts = mime.split('--WRAP')
    const attachmentPart = parts[2]!
    const base64Lines = attachmentPart
      .slice(attachmentPart.indexOf('\r\n\r\n') + 4)
      .replace(/\r\n$/, '')
      .split('\r\n')
    expect(base64Lines.length).toBeGreaterThan(1)
    for (const line of base64Lines.slice(0, -1)) {
      expect(line.length).toBe(76)
    }
  })

  it('RFC2231 の filename* が UTF-8 パーセントエンコードで正しく出力され、復号すると元のファイル名に一致する', () => {
    const filename = '【北海道大学かるた会】参加申込書.xlsx'
    const mime = buildDraftMime(baseInput({ attachment: {
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: Buffer.from([1, 2, 3]),
    } }))
    const match = mime.match(/filename\*=UTF-8''([^;\r\n]+)/)
    expect(match).not.toBeNull()
    const encoded = match![1]!
    expect(decodeURIComponent(encoded)).toBe(filename)
    // ASCII 互換フォールバックも併記されている
    expect(mime).toMatch(/filename="attachment\.xlsx"/)
  })

  it('ASCII のみのファイル名は互換 filename にそのまま使われる', () => {
    const mime = buildDraftMime(baseInput({ attachment: {
      filename: 'entry-form.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: Buffer.from([1, 2, 3]),
    } }))
    expect(mime).toContain('filename="entry-form.xlsx"')
    expect(mime).toContain("filename*=UTF-8''entry-form.xlsx")
  })
})

describe('buildDraftMime — 宛先・差出人の検証', () => {
  const attachment = {
    filename: 'form.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: Buffer.from('x'),
  }
  const base = { from: 'club@example.invalid', to: 'organizer@example.invalid', subject: '件名', bodyText: '本文', attachment }

  it('To に改行を含むとヘッダ注入を拒否する', () => {
    expect(() =>
      buildDraftMime({ ...base, to: 'a@example.invalid\r\nBcc: leak@example.invalid' }),
    ).toThrow('改行や制御文字')
  })

  it('形式が不正な宛先を拒否する（打ち間違いのまま下書きを作らない）', () => {
    expect(() => buildDraftMime({ ...base, to: 'organizer' })).toThrow('形式が正しくありません')
    expect(() => buildDraftMime({ ...base, to: 'user@' })).toThrow('形式が正しくありません')
  })

  it('From が空なら明示的なエラーにする', () => {
    expect(() => buildDraftMime({ ...base, from: '' })).toThrow('設定されていません')
  })
})
