import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripMailFooter } from '@/lib/mail-body-cleaner'
import {
  renderPdfToJpegs,
  type ImageRenderResult,
} from '@/lib/attachment-image-render'

/**
 * メール本文を「画像」として LINE に配信するためのレンダラ。
 *
 * 件名・本文・訂正フラグを A4 縦の HTML テンプレートに流し込み、libreoffice
 * 経由で PDF を生成、既存 {@link renderPdfToJpegs} で JPEG 配列に変換する。
 * スマホ LINE 上でテキストが縦に伸びて読みづらい問題を、スクショ相当の
 * 1 枚絵で置き換えるのが目的 (要件 §3.1)。
 *
 * 失敗時 (libreoffice クラッシュ / フォント欠落 / ディスク不足等) は throw し、
 * 呼び出し側 (line-broadcast.ts) の text fallback パスに委ねる (要件 §3.5)。
 */

/**
 * 訂正版マーカー。mail-body-cleaner.ts の CORRECTION_PREFIX と同一表記にして、
 * text fallback 経路 (buildBroadcastBody) と画像ヘッダーで `【訂正】` の見た目を
 * 揃える (要件 §3.2)。
 */
const CORRECTION_MARKER = '【訂正】'

/** 本文が空 (null / 空文字 / footer のみ) のときに描画するプレースホルダ (要件 §3.7)。 */
const EMPTY_BODY_PLACEHOLDER = '(本文なし)'

/**
 * libreoffice cold-start は本番 ARM 機で ~6s 観測。120s で十分な headroom を
 * 取る。attachment-image-render.ts の renderDocxToJpegs と同じ値。
 */
const LIBREOFFICE_TIMEOUT_MS = 120_000

export interface BuildBodyImageInput {
  /** メール件名 (`mail_messages.subject`)。空ならヘッダーを出さない。 */
  subject: string | null | undefined
  /** 元のメール本文 (`mail_messages.body_text`)。footer 除去前の生テキスト。 */
  rawBody: string | null | undefined
  /** 訂正版かどうか (`tournament_drafts.is_correction`)。 */
  isCorrection: boolean
}

/**
 * HTML のテキストコンテンツに安全に埋め込めるようエスケープする。件名・本文は
 * `<h1>` / `<pre>` のテキストノードに入る (属性には入らない) が、`"` / `'` も
 * 含めた標準セットを潰しておき、メール由来文字列によるマークアップ崩れ・
 * インジェクションを確実に防ぐ。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 件名・本文・訂正フラグを A4 縦の HTML 文字列に組み立てる純関数。
 *
 * ヘッダー (`<h1>`) の分岐:
 *   - 件名あり / 訂正なし → `【件名】`
 *   - 件名あり / 訂正あり → `【訂正】【件名】`
 *   - 件名なし / 訂正あり → `【訂正】` 単独
 *   - 件名なし / 訂正なし → `<h1>` ごと省略
 *
 * 本文は text 経路と同じく Google Groups footer を除去 (要件 §3.3) し、空なら
 * `(本文なし)` に倒す。件名・本文はともに HTML エスケープして埋め込む。
 */
export function buildBodyImageHtml(input: BuildBodyImageInput): string {
  const subject = input.subject?.trim() ?? ''
  const cleanedBody = stripMailFooter(input.rawBody ?? '')
  const body =
    cleanedBody.trim() === '' ? EMPTY_BODY_PLACEHOLDER : cleanedBody

  const headerParts: string[] = []
  if (input.isCorrection) headerParts.push(CORRECTION_MARKER)
  if (subject) headerParts.push(`【${escapeHtml(subject)}】`)
  const headerHtml =
    headerParts.length > 0 ? `  <h1>${headerParts.join('')}</h1>\n` : ''

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4 portrait; margin: 25mm 20mm; }
    body { font-family: 'Noto Sans CJK JP', sans-serif; font-size: 11pt; line-height: 1.7; color: #000; }
    h1 { font-size: 14pt; font-weight: bold; margin: 0 0 1em 0; border-bottom: 1px solid #888; padding-bottom: 0.5em; }
    pre { font-family: 'Noto Sans CJK JP', sans-serif; white-space: pre-wrap; word-break: break-word; margin: 0; }
  </style>
</head>
<body>
${headerHtml}  <pre>${escapeHtml(body)}</pre>
</body>
</html>
`
}

/**
 * 生成 HTML を libreoffice で PDF 化し `outDir` に同名 (basename) で書き出す。
 * `--headless --convert-to pdf` は 1 回ごとに soffice を起動して終了する
 * one-shot 変換なので、常駐 daemon の管理は不要。
 *
 * NOTE(task3 / #76): attachment-image-render.ts の renderDocxToJpegs にほぼ
 * 同じ libreoffice 呼び出しがある。cleanup タスクで共通 helper
 * (`runLibreofficeConvertToPdf`) に集約する予定。それまでは本文画像化パスを
 * cross-file 依存なしで自己完結させるため、意図的にローカルに置く。
 */
async function runLibreofficeConvertToPdf(
  inputPath: string,
  outDir: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'libreoffice',
      ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const stderrChunks: Buffer[] = []
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    // stdout を drain しないと、libreoffice が多めに吐いたとき OS パイプ
    // バッファが埋まって子プロセスが write でブロック → timeout まで
    // 進まなくなる (attachment-image-render.ts と同じ対策)。内容は使わない。
    proc.stdout.resume()
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(
        new Error(`libreoffice timed out after ${LIBREOFFICE_TIMEOUT_MS}ms`),
      )
    }, LIBREOFFICE_TIMEOUT_MS)
    proc.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    proc.on('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      reject(
        new Error(
          `libreoffice exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`,
        ),
      )
    })
  })
}

/**
 * 本文 + 件名 + 訂正フラグを JPEG ページ配列に描画する。
 *
 * 1. {@link buildBodyImageHtml} で HTML を組み立て tmpdir に書き出し
 * 2. libreoffice で PDF 化
 * 3. 既存 {@link renderPdfToJpegs} で JPEG 化 (30 ページ超は `truncated: true`)
 * 4. tmpdir を best-effort でクリーンアップ
 *
 * 失敗時は throw する。呼び出し側が text fallback に倒す。
 */
export async function renderBodyImageToJpegs(
  input: BuildBodyImageInput,
): Promise<ImageRenderResult> {
  const html = buildBodyImageHtml(input)
  const workDir = await mkdtemp(join(tmpdir(), 'kagetra-mailbody-'))
  try {
    const inputPath = join(workDir, 'body.html')
    await writeFile(inputPath, html, 'utf8')
    await runLibreofficeConvertToPdf(inputPath, workDir)
    const pdfBuffer = await readFile(join(workDir, 'body.pdf'))
    return await renderPdfToJpegs(pdfBuffer)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup. A leftover tmpdir is preferable to crashing the
      // render path; the system tmp reaper will sweep it eventually.
    })
  }
}
