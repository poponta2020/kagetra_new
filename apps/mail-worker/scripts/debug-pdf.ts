/**
 * Debug script for PDF base64 invalid bug (worklog 2026-05-08 + 2026-05-09
 * carryover). Production pipeline returns
 *   400 invalid_request_error: messages.0.content.0.pdf.source.base64.data:
 *   The PDF specified was not valid.
 * for ~60% of PDF attachments. The PDFs themselves are valid (verified via
 * `file` → "PDF document, version 1.7, 4 page(s)") and DB-side bytea is
 * intact (signature `255044462d312e37` = "%PDF-1.7" preserved), so this
 * isolates whether the failure is inside Anthropic itself by posting the
 * file directly with minimal wrapping — bypassing classifier.ts +
 * extract/orchestrator.ts.
 *
 * Usage:
 *   pnpm --filter @kagetra/mail-worker exec tsx scripts/debug-pdf.ts <pdf-path> [...more]
 * Reads ANTHROPIC_API_KEY from <repo>/.env.
 */
import { config as loadDotenv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '..', '..', '..', '.env')
loadDotenv({ path: envPath })

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error(`ANTHROPIC_API_KEY missing in env (expected at ${envPath}).`)
  process.exit(1)
}
const client = new Anthropic({ apiKey })

async function probe(pdfPath: string): Promise<void> {
  const buf = readFileSync(pdfPath)
  const base64 = buf.toString('base64')
  console.log(`\n=== ${pdfPath} ===`)
  console.log(`  bytes=${buf.length}, base64.length=${base64.length}`)
  console.log(`  first 16 bytes (hex) = ${buf.subarray(0, 16).toString('hex')}`)
  console.log(`  base64 head/tail     = ${base64.slice(0, 24)} ... ${base64.slice(-24)}`)
  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            {
              type: 'text',
              text: 'この PDF のタイトル (冒頭の見出し) を一行で答えてください。',
            },
          ],
        },
      ],
    })
    const text = res.content.find((b) => b.type === 'text')
    const out = text && 'text' in text ? text.text : JSON.stringify(res.content)
    console.log(`  SUCCESS: ${out}`)
    console.log(`  tokens: in=${res.usage.input_tokens} out=${res.usage.output_tokens}`)
  } catch (err) {
    const e = err as { status?: number; error?: { error?: { type?: string } }; message?: string }
    console.log(`  FAIL: status=${e.status ?? '?'} type=${e.error?.error?.type ?? '?'}`)
    console.log(`        message: ${e.message?.slice(0, 250)}`)
  }
}

// Production-like wrapping: invoke AnthropicSonnet46Extractor directly so we
// see whether the failure is reproduced by mail-worker's actual configuration
// (system prompt + cache_control + Zod-derived tools + forced tool_choice +
// document block ordering). Loaded dynamically so the simple `probe()` mode
// remains usable without compiling the rest of the package.
async function probeProductionLike(pdfPath: string): Promise<void> {
  const { AnthropicSonnet46Extractor } = await import(
    '../src/classify/llm/anthropic.js'
  )
  const { buildSystemPrompt, PROMPT_VERSION } = await import(
    '../src/classify/prompt.js'
  )
  const buf = readFileSync(pdfPath)
  const base64 = buf.toString('base64')
  console.log(`\n=== production-like wrapping: ${pdfPath} ===`)
  const extractor = new AnthropicSonnet46Extractor({ apiKey: apiKey! })
  try {
    const res = await extractor.extract({
      systemPrompt: buildSystemPrompt(),
      promptVersion: PROMPT_VERSION,
      emailMeta: {
        subject: '横浜大会受付名簿テスト',
        from: 'test@test.com',
        date: new Date(),
      },
      emailBodyText: 'これは debug-pdf.ts の production-like 再現テストです。',
      attachments: [{ kind: 'pdf', filename: 'test.pdf', base64 }],
    })
    console.log(`  SUCCESS: ${JSON.stringify(res.parsed).slice(0, 200)}`)
    console.log(
      `  tokens: in=${res.tokensInput} out=${res.tokensOutput} cost=$${res.costUsd}`,
    )
  } catch (err) {
    const e = err as Error & { status?: number }
    console.log(`  FAIL: status=${e.status ?? '?'}`)
    console.log(`        message: ${e.message?.slice(0, 280)}`)
  }
}

// Stage 3: pull `data` straight from mail_attachments and contrast with the
// filesystem copy. Identical bytes → bug is elsewhere; differing bytes →
// drizzle/pg are returning something other than a raw Buffer (hex-string
// decoded as UTF-8, double-encoded base64, etc.).
async function probeDbAttachment(
  attachmentId: number,
  fsPath: string,
): Promise<void> {
  const { getDb, closeDb } = await import('../src/db.js')
  const { mailAttachments } = await import('@kagetra/shared/schema')
  const { eq } = await import('drizzle-orm')
  const db = getDb()
  console.log(
    `\n=== DB attachment id=${attachmentId} vs FS ${fsPath} ===`,
  )
  try {
    const row = await db.query.mailAttachments.findFirst({
      where: eq(mailAttachments.id, attachmentId),
      columns: { data: true, filename: true, contentType: true },
    })
    if (!row) {
      console.log('  not found')
      return
    }
    const raw = row.data as unknown
    console.log(`  drizzle returned typeof: ${typeof raw}`)
    console.log(`  Buffer.isBuffer: ${Buffer.isBuffer(raw)}`)
    console.log(
      `  instanceof Uint8Array: ${raw instanceof Uint8Array}`,
    )
    const dbBuf = Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(raw as ArrayLike<number>)
    const fsBuf = readFileSync(fsPath)
    console.log(`  DB length: ${dbBuf.length}, FS length: ${fsBuf.length}`)
    console.log(`  DB first 16 hex: ${dbBuf.subarray(0, 16).toString('hex')}`)
    console.log(`  FS first 16 hex: ${fsBuf.subarray(0, 16).toString('hex')}`)
    console.log(`  DB last 16 hex : ${dbBuf.subarray(-16).toString('hex')}`)
    console.log(`  FS last 16 hex : ${fsBuf.subarray(-16).toString('hex')}`)
    console.log(
      `  Buffer.compare(db, fs): ${Buffer.compare(dbBuf, fsBuf)} (0 = identical)`,
    )

    // Mimic classifier.ts:108 exactly and try Anthropic with that base64.
    const base64 = Buffer.from(raw as ArrayLike<number>).toString('base64')
    console.log(`  classifier-style base64 length: ${base64.length}`)
    console.log(`  base64 head: ${base64.slice(0, 24)}`)
    console.log(`  base64 tail: ${base64.slice(-24)}`)
    try {
      const res = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64,
                },
              },
              {
                type: 'text',
                text: 'タイトルを一行で。',
              },
            ],
          },
        ],
      })
      const text = res.content.find((b) => b.type === 'text')
      console.log(
        `  Anthropic SUCCESS: ${text && 'text' in text ? text.text : '?'}`,
      )
    } catch (err) {
      const e = err as { message?: string; status?: number }
      console.log(`  Anthropic FAIL: status=${e.status ?? '?'} ${e.message?.slice(0, 200)}`)
    }
  } finally {
    await closeDb()
  }
}

// Stage 5: same wrapping as `classifyMail`, but selectively override
// subject / body / date / filename to isolate which field triggers the
// "The PDF specified was not valid" rejection.
async function probeMailIsolated(
  messageId: number,
  isolate: {
    subject?: string
    body?: string
    date?: Date
    filename?: string
    from?: string
  },
): Promise<void> {
  const { getDb, closeDb } = await import('../src/db.js')
  const { mailMessages } = await import('@kagetra/shared/schema')
  const { eq } = await import('drizzle-orm')
  const { AnthropicSonnet46Extractor } = await import(
    '../src/classify/llm/anthropic.js'
  )
  const { buildSystemPrompt, PROMPT_VERSION } = await import(
    '../src/classify/prompt.js'
  )
  const db = getDb()
  try {
    const mail = await db.query.mailMessages.findFirst({
      where: eq(mailMessages.id, messageId),
      with: {
        attachments: {
          columns: {
            filename: true,
            contentType: true,
            data: true,
            extractedText: true,
            extractionStatus: true,
          },
        },
      },
    })
    if (!mail) {
      console.log('  mail not found')
      return
    }
    const attachments: Array<
      | { kind: 'pdf'; filename: string; base64: string }
      | { kind: 'text'; filename: string; text: string }
    > = []
    for (const att of mail.attachments) {
      if (
        att.contentType === 'application/pdf' &&
        att.extractionStatus !== 'failed'
      ) {
        const raw = att.data as unknown
        // PATCH: drizzle's `with` returns bytea as `\x<hex>` string instead of
        // Buffer. Detect that shape and hex-decode; fall back to the regular
        // Buffer path for environments where drizzle behaves correctly.
        const buf =
          Buffer.isBuffer(raw)
            ? raw
            : typeof raw === 'string' && raw.startsWith('\\x')
              ? Buffer.from(raw.slice(2), 'hex')
              : Buffer.from(raw as ArrayLike<number>)
        console.log(
          `  [diag] raw typeof=${typeof raw} | patched buf.length=${buf.length} sig=${buf.subarray(0, 4).toString('hex')}`,
        )
        attachments.push({
          kind: 'pdf',
          filename: isolate.filename ?? att.filename,
          base64: buf.toString('base64'),
        })
      } else if (att.extractedText) {
        attachments.push({
          kind: 'text',
          filename: att.filename,
          text: att.extractedText,
        })
      }
    }
    const extractor = new AnthropicSonnet46Extractor({ apiKey: apiKey! })
    const desc = Object.entries(isolate)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 30)}..."` : v}`)
      .join(', ')
    console.log(`\n=== isolated messageId=${messageId} [${desc || '(no overrides)'}] ===`)
    try {
      const res = await extractor.extract({
        systemPrompt: buildSystemPrompt(),
        promptVersion: PROMPT_VERSION,
        emailMeta: {
          subject: isolate.subject ?? mail.subject ?? '',
          from: isolate.from ?? mail.fromAddress,
          date: isolate.date ?? mail.receivedAt,
        },
        emailBodyText: isolate.body ?? mail.bodyText ?? mail.bodyHtml ?? '',
        attachments,
      })
      console.log(`  SUCCESS: ${JSON.stringify(res.parsed).slice(0, 200)}`)
    } catch (err) {
      const e = err as Error & { status?: number }
      console.log(`  FAIL: status=${e.status ?? '?'} ${e.message?.slice(0, 240)}`)
    }
  } finally {
    await closeDb()
  }
}

// Stage 6: same wrapping as `probeProductionLike`, but read PDF bytes from
// the DB (mimicking what classifier.ts does) instead of the filesystem. If
// this fails while FS variant succeeds, the bug lives in how drizzle/pg
// hands the bytea over (e.g. shared ArrayBuffer subview).
async function probeProductionLikeFromDb(attachmentId: number): Promise<void> {
  const { getDb, closeDb } = await import('../src/db.js')
  const { mailAttachments } = await import('@kagetra/shared/schema')
  const { eq } = await import('drizzle-orm')
  const { AnthropicSonnet46Extractor } = await import(
    '../src/classify/llm/anthropic.js'
  )
  const { buildSystemPrompt, PROMPT_VERSION } = await import(
    '../src/classify/prompt.js'
  )
  const db = getDb()
  try {
    const row = await db.query.mailAttachments.findFirst({
      where: eq(mailAttachments.id, attachmentId),
      columns: { data: true, filename: true },
    })
    if (!row) {
      console.log('  attachment not found')
      return
    }
    const raw = row.data as unknown
    // EXACTLY mirror classifier.ts:108
    const base64 = Buffer.from(raw as ArrayLike<number>).toString('base64')
    console.log(
      `\n=== production-like wrapping (DB-sourced base64) attachmentId=${attachmentId} ===`,
    )
    console.log(`  base64 length: ${base64.length}`)
    const extractor = new AnthropicSonnet46Extractor({ apiKey: apiKey! })
    try {
      const res = await extractor.extract({
        systemPrompt: buildSystemPrompt(),
        promptVersion: PROMPT_VERSION,
        emailMeta: {
          subject: 'test',
          from: 'test@test.com',
          date: new Date(),
        },
        emailBodyText: 'short test body',
        attachments: [{ kind: 'pdf', filename: 'test.pdf', base64 }],
      })
      console.log(`  SUCCESS: ${JSON.stringify(res.parsed).slice(0, 200)}`)
    } catch (err) {
      const e = err as Error & { status?: number }
      console.log(`  FAIL: status=${e.status ?? '?'} ${e.message?.slice(0, 250)}`)
    }
  } finally {
    await closeDb()
  }
}

// Stage 4: run the real `classifyMail` against a stored mail_messages row.
// This is the closest possible reproduction of the pipeline path short of
// running `pnpm start` itself — same DB read, same builder, same extractor.
async function probeClassifyMail(messageId: number): Promise<void> {
  const { classifyMail } = await import('../src/classify/classifier.js')
  const { AnthropicSonnet46Extractor } = await import(
    '../src/classify/llm/anthropic.js'
  )
  const { getDb, closeDb } = await import('../src/db.js')
  const db = getDb()
  const llm = new AnthropicSonnet46Extractor({ apiKey: apiKey! })
  console.log(`\n=== classifyMail messageId=${messageId} (force=true) ===`)
  try {
    const result = await classifyMail(db, messageId, llm, { force: true })
    console.log(`  kind: ${result.kind}`)
    if (result.kind === 'tournament' || result.kind === 'noise') {
      const r = result as { result: { parsed: unknown; tokensInput: number; tokensOutput: number; costUsd: number } }
      console.log(`  parsed: ${JSON.stringify(r.result.parsed).slice(0, 250)}`)
      console.log(`  tokens: in=${r.result.tokensInput} out=${r.result.tokensOutput} cost=$${r.result.costUsd}`)
    } else if (result.kind === 'failed') {
      const r = result as { reason: string; rawResponse: string | null; attemptedModel: string }
      console.log(`  reason: ${r.reason?.slice(0, 280)}`)
      console.log(`  rawResponse: ${r.rawResponse?.slice(0, 280)}`)
      console.log(`  model: ${r.attemptedModel}`)
    }
  } finally {
    await closeDb()
  }
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Pass <pdf-path> [...more]    -- simple + production-like probes')
  console.error('Or  --db <id> <pdf-path>     -- compare DB attachment vs FS file')
  console.error('Or  --mail <message-id>      -- run classifyMail on a stored row')
  process.exit(1)
}
if (args[0] === '--db-prod') {
  const id = Number(args[1])
  if (!Number.isInteger(id)) {
    console.error('Usage: --db-prod <attachment-id>')
    process.exit(1)
  }
  await probeProductionLikeFromDb(id)
} else if (args[0] === '--mail') {
  const id = Number(args[1])
  if (!Number.isInteger(id)) {
    console.error('Usage: --mail <message-id>')
    process.exit(1)
  }
  await probeClassifyMail(id)
} else if (args[0] === '--isolate') {
  // --isolate <message-id> — run multiple probes to bisect which field triggers
  // the rejection. Order: no-override baseline (= classifyMail) → subject only
  // → body only → date only → filename only. Each call ~$0.01.
  const id = Number(args[1])
  if (!Number.isInteger(id)) {
    console.error('Usage: --isolate <message-id>')
    process.exit(1)
  }
  // baseline (should reproduce failure)
  await probeMailIsolated(id, {})
  // 4-field override (subject/body/date/filename) — still FAIL means trigger
  // lives in fields outside that set (most likely `from`).
  await probeMailIsolated(id, {
    subject: 'test subject',
    body: 'this is a short test body.',
    date: new Date('2026-05-09T00:00:00Z'),
    filename: 'test.pdf',
  })
  // 5-field override — adds `from`. If SUCCESS while #2 FAILs, from-address
  // is the trigger.
  await probeMailIsolated(id, {
    subject: 'test subject',
    body: 'this is a short test body.',
    date: new Date('2026-05-09T00:00:00Z'),
    filename: 'test.pdf',
    from: 'test@example.com',
  })
  // from-only override (everything else from real mail) — confirms from is
  // sufficient on its own.
  await probeMailIsolated(id, { from: 'test@example.com' })
} else if (args[0] === '--db') {
  const id = Number(args[1])
  const fsPath = args[2]
  if (!Number.isInteger(id) || !fsPath) {
    console.error('Usage: --db <attachment-id> <fs-pdf-path>')
    process.exit(1)
  }
  await probeDbAttachment(id, fsPath)
} else {
  for (const p of args) {
    await probe(p)
    await probeProductionLike(p)
  }
}
