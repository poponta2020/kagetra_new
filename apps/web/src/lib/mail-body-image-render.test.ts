import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import {
  buildBodyImageHtml,
  renderBodyImageToJpegs,
} from './mail-body-image-render'

describe('buildBodyImageHtml', () => {
  it('renders the subject header + body for a normal mail', () => {
    const html = buildBodyImageHtml({
      subject: '第48回大会のお知らせ',
      rawBody: '本文1行目\n本文2行目',
      isCorrection: false,
    })
    expect(html).toMatchInlineSnapshot(`
      "<!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <style>
          @page { size: A4 portrait; margin: 25mm 20mm; }
          body { font-family: 'Noto Sans CJK JP', sans-serif; font-size: 11pt; line-height: 1.3; color: #000; }
          h1 { font-size: 14pt; font-weight: bold; margin: 0 0 1em 0; border-bottom: 1px solid #888; padding-bottom: 0.5em; }
          pre { font-family: 'Noto Sans CJK JP', sans-serif; white-space: pre-wrap; word-break: break-word; margin: 0; }
        </style>
      </head>
      <body>
        <h1>【第48回大会のお知らせ】</h1>
        <pre>本文1行目
      本文2行目</pre>
      </body>
      </html>
      "
    `)
  })

  it('prepends 【訂正】 before 【件名】 for corrections', () => {
    const html = buildBodyImageHtml({
      subject: '第48回大会のお知らせ(訂正版)',
      rawBody: '訂正後本文',
      isCorrection: true,
    })
    expect(html).toContain(
      '<h1>【訂正】【第48回大会のお知らせ(訂正版)】</h1>',
    )
    expect(html).toContain('<pre>訂正後本文</pre>')
  })

  it('omits the header entirely when subject is empty and not a correction', () => {
    const html = buildBodyImageHtml({
      subject: '',
      rawBody: '本文だけ',
      isCorrection: false,
    })
    expect(html).not.toContain('<h1>')
    expect(html).toContain('<pre>本文だけ</pre>')
  })

  it('shows 【訂正】 alone when a correction has no subject', () => {
    const html = buildBodyImageHtml({
      subject: null,
      rawBody: '本文',
      isCorrection: true,
    })
    expect(html).toContain('<h1>【訂正】</h1>')
  })

  it('strips the Google Groups footer before rendering the body', () => {
    const html = buildBodyImageHtml({
      subject: 'テスト',
      rawBody:
        '本文\n\n-- \nこのメールは Google グループ「x」に登録しているユーザーに送られています。\nfooter',
      isCorrection: false,
    })
    expect(html).toContain('<pre>本文</pre>')
    expect(html).not.toContain('Google グループ')
  })

  it('falls back to the (本文なし) placeholder when the body is empty', () => {
    const html = buildBodyImageHtml({
      subject: 'タイトル',
      rawBody: null,
      isCorrection: false,
    })
    expect(html).toContain('<pre>(本文なし)</pre>')
  })

  it('escapes HTML-special characters in subject and body', () => {
    const html = buildBodyImageHtml({
      subject: '<script> & "危険"',
      rawBody: 'a < b && c > d',
      isCorrection: false,
    })
    expect(html).toContain(
      '【&lt;script&gt; &amp; &quot;危険&quot;】',
    )
    expect(html).toContain('<pre>a &lt; b &amp;&amp; c &gt; d</pre>')
    expect(html).not.toContain('<script>')
  })

  it('trims surrounding whitespace from the subject', () => {
    const html = buildBodyImageHtml({
      subject: '  前後空白  ',
      rawBody: '本文',
      isCorrection: false,
    })
    expect(html).toContain('【前後空白】')
  })
})

/**
 * 要件 §4.4: libreoffice を spawn する子プロセスは mock しない (本番と同じ
 * 環境前提)。CI / 本番には libreoffice があるので走り、Windows ローカル等で
 * 無い環境では skip する。
 */
function libreofficeAvailable(): boolean {
  try {
    execFileSync('libreoffice', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const describeIfLibreoffice = libreofficeAvailable() ? describe : describe.skip

describeIfLibreoffice(
  'renderBodyImageToJpegs (integration: requires libreoffice)',
  () => {
    it('renders a short body to exactly one JPEG page (no blank first page)', async () => {
      const result = await renderBodyImageToJpegs({
        subject: 'スモークテスト',
        rawBody: 'これは本文画像化のスモークテストです。',
        isCorrection: false,
      })
      // Regression guard for issue #93: a one-screen body must render to a
      // single page. The libreoffice HTML "Web" layout used to prepend a
      // blank first page (content on page 2), which surfaced as a white
      // first image on LINE; --writer (runLibreofficeConvertToPdf) avoids it.
      // A spurious blank page would make this 2, so assert exactly 1.
      expect(result.pages.length).toBe(1)
      expect(result.truncated).toBe(false)
      // JPEG magic bytes: FF D8 FF
      const first = result.pages[0]!
      expect(first[0]).toBe(0xff)
      expect(first[1]).toBe(0xd8)
      expect(first[2]).toBe(0xff)
    }, 120_000)
  },
)
