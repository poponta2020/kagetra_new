import { spawn } from 'node:child_process'
import { readdir, readFile, rm, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import {
  attachmentShareTokens,
  type mailAttachments,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'

/**
 * Hard cap on per-attachment page count before we give up image-rendering
 * and fall back to a download link. Tuned to keep a single mail under one
 * LINE batch push (max 5 messages, called with 1.5s sleep between batches).
 */
export const RENDER_PAGE_LIMIT = 30

/**
 * 150 DPI was chosen to match A4 ≈ 1240x1754 px output — readable on a
 * phone screen without zoom, ~150-300 KB per JPEG @ quality 85.
 */
const RENDER_DPI = 150
const JPEG_QUALITY = 85

/**
 * Default sub-process timeout. libreoffice cold-start on Lightsail ARM
 * has been observed up to ~6s; 60s gives us 10× headroom for chunky docx
 * with many embedded images.
 */
const SUBPROCESS_TIMEOUT_MS = 60_000

export interface ImageRenderResult {
  pages: Buffer[]
  /**
   * True when the source had more pages than {@link RENDER_PAGE_LIMIT}
   * and the trailing pages were dropped. Callers should fall back to a
   * download-link message when this is set.
   */
  truncated: boolean
}

/**
 * Run an external command with a hard timeout. stdout is captured (mostly
 * for libreoffice's noisy progress text — we don't actually use it) and
 * stderr is surfaced into the rejection reason so failures point at the
 * underlying tool's output rather than a bare exit code.
 */
async function runCommand(
  cmd: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? SUBPROCESS_TIMEOUT_MS
  return await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderrChunks: Buffer[] = []
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    // r-final-11 should_fix: stdout を必ず drain する。pdftoppm /
    // libreoffice が多めに stdout を吐いた場合、未消費だと OS パイプ
    // バッファが埋まって子プロセスが書き込みでブロック → タイムアウト
    // まで何もできない。内容は使わないので `resume()` で読み流す。
    proc.stdout.resume()
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
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
          `${cmd} exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`,
        ),
      )
    })
  })
}

/**
 * Render a PDF to JPEG pages via `pdftoppm` (poppler-utils). Stops after
 * {@link RENDER_PAGE_LIMIT} pages and signals truncation to the caller.
 *
 * pdftoppm is preferred over the pdfjs-dist + canvas combo originally
 * specced in the requirements doc because:
 *   - poppler is a single OS package, deployable on Lightsail in one
 *     apt-get line. No node-gyp build, no native binary tracking.
 *   - The output is identical for our needs (raster JPEG per page).
 *   - Failure modes are easy to reason about: subprocess exit code + stderr.
 */
export async function renderPdfToJpegs(
  pdfBuffer: Buffer,
  options: { maxPages?: number } = {},
): Promise<ImageRenderResult> {
  const maxPages = options.maxPages ?? RENDER_PAGE_LIMIT
  const workDir = await mkdtemp(join(tmpdir(), 'kagetra-pdf-'))
  try {
    const inputPath = join(workDir, 'input.pdf')
    await writeFile(inputPath, pdfBuffer)
    // -l <max+1>: ask for one more page than the cap so we can detect
    // truncation without parsing pdfinfo. If pdftoppm wrote fewer pages
    // than that, we know the PDF had ≤ cap pages.
    await runCommand('pdftoppm', [
      '-jpeg',
      '-r',
      String(RENDER_DPI),
      '-jpegopt',
      `quality=${JPEG_QUALITY}`,
      '-l',
      String(maxPages + 1),
      inputPath,
      join(workDir, 'page'),
    ])

    const files = (await readdir(workDir))
      .filter(
        (f) =>
          f.startsWith('page-') && (f.endsWith('.jpg') || f.endsWith('.jpeg')),
      )
      // pdftoppm pads page numbers consistently (page-001.jpg) so lexical
      // sort matches natural order up to several thousand pages.
      .sort()

    const truncated = files.length > maxPages
    const usedFiles = truncated ? files.slice(0, maxPages) : files
    const pages: Buffer[] = []
    for (const file of usedFiles) {
      pages.push(await readFile(join(workDir, file)))
    }
    return { pages, truncated }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup. A leftover tmpdir is preferable to crashing
      // the render path; the system tmp reaper will sweep it eventually.
    })
  }
}

/**
 * Render a `.docx` (or anything libreoffice can read) to JPEG pages by
 * converting through PDF. The intermediate PDF lives only in the tmpdir.
 *
 * `libreoffice --headless --convert-to pdf` is the documented one-shot
 * conversion; it spawns a fresh `soffice` process per call and exits when
 * done, so we don't need to manage a long-running daemon.
 */
export async function renderDocxToJpegs(
  docxBuffer: Buffer,
  options: { maxPages?: number } = {},
): Promise<ImageRenderResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'kagetra-docx-'))
  try {
    const inputPath = join(workDir, 'input.docx')
    await writeFile(inputPath, docxBuffer)
    await runCommand(
      'libreoffice',
      [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        workDir,
        inputPath,
      ],
      // libreoffice cold-start can be slow; give it more headroom than
      // pdftoppm which usually runs in milliseconds.
      { timeoutMs: 120_000 },
    )
    const pdfBuffer = await readFile(join(workDir, 'input.pdf'))
    return await renderPdfToJpegs(pdfBuffer, options)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Default token TTL — matches the requirements doc (60 days from issue).
 * Daily cleanup (`scripts/cleanup-expired-tokens.ts`) removes rows past
 * `expires_at + 7 day` so a re-issue inside the grace window finds the
 * already-expired token and writes a new one.
 */
export const SHARE_TOKEN_TTL_DAYS = 60

/**
 * Look up (or mint) a public download token for a given attachment.
 *
 * The token is reusable while live, so repeated sends of the same
 * attachment to LINE do not stamp the DB with one row per push. New
 * tokens are 32-character URL-safe base64 — collision probability is
 * effectively zero against any realistic token volume.
 *
 * Invariant: at most ONE attachment_share_tokens row per mail_attachment_id.
 * Expired rows are mutated in place (token + expires_at refreshed) rather
 * than inserting a new row, so:
 *   - the route handler never has to disambiguate between multiple rows
 *     for the same attachment
 *   - the previous (leaked-via-LINE-link) token stops working immediately
 *     once a refresh runs, instead of staying valid until cleanup deletes
 *     it days later
 * cleanup-expired-tokens.ts still operates on the same single row, so the
 * 7-day grace continues to apply for rows whose attachment was never
 * re-shared.
 */
export async function getOrCreateShareToken(
  db: typeof appDb,
  mailAttachmentId: number,
  options: { ttlDays?: number; now?: Date } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const ttlDays = options.ttlDays ?? SHARE_TOKEN_TTL_DAYS
  const now = options.now ?? new Date()
  const candidateToken = randomBytes(24).toString('base64url')
  const candidateExpiresAt = new Date(now.getTime() + ttlDays * 86_400_000)

  // r-final-6 should_fix: SELECT → INSERT/UPDATE が非原子的だと、並行
  // 配信で両方が「未登録」と判断してから片方が 23505 (UNIQUE 違反) に
  // 倒れて broadcast 全体を failed にしてしまう。INSERT ... ON CONFLICT
  // で 1 statement にまとめる。
  //
  // SQL の動作:
  //   - 行が無い → INSERT (token / expires_at / access_count=0 で着地)
  //   - 行があって期限内 → 既存値を維持 (excluded を採用しない)
  //   - 行があって期限切れ → token / expires_at / access_count=0 を更新
  // RETURNING で確定値を取得し、API 呼び出しの戻り値とする。
  const inserted = await db
    .insert(attachmentShareTokens)
    .values({
      mailAttachmentId,
      token: candidateToken,
      expiresAt: candidateExpiresAt,
    })
    .onConflictDoUpdate({
      target: attachmentShareTokens.mailAttachmentId,
      set: {
        token: sql`CASE WHEN ${attachmentShareTokens.expiresAt} > now() THEN ${attachmentShareTokens.token} ELSE EXCLUDED.token END`,
        expiresAt: sql`CASE WHEN ${attachmentShareTokens.expiresAt} > now() THEN ${attachmentShareTokens.expiresAt} ELSE EXCLUDED.expires_at END`,
        accessCount: sql`CASE WHEN ${attachmentShareTokens.expiresAt} > now() THEN ${attachmentShareTokens.accessCount} ELSE 0 END`,
      },
    })
    .returning({
      token: attachmentShareTokens.token,
      expiresAt: attachmentShareTokens.expiresAt,
    })

  const row = inserted[0]
  if (!row) {
    throw new Error('getOrCreateShareToken: upsert returned no row')
  }
  return { token: row.token, expiresAt: row.expiresAt }
}

// Re-export the inferred row type so callers that touch the shareTokens
// table type-check against the same source of truth.
export type MailAttachmentRow = typeof mailAttachments.$inferSelect
