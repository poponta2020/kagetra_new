# コードレビュー依頼 — PR #21（第1回）

## PR 情報
- **タイトル**: feat(mail-worker): PR5 — 定期実行 + LINE 通知 + デプロイ配線 (P3-A close)
- **URL**: https://github.com/poponta2020/kagetra_new/pull/21
- **ブランチ**: `feat/mail-tournament-import-pr5` → `main`

## 依頼内容

以下のPR差分をレビューしてください。Claudeが実装した変更を、別の視点から評価してもらうことが目的です。

### レビュー観点（優先度順）

1. **バグ・ロジックの誤り** — 条件分岐ミス、null 安全性欠如、レース、非同期処理の扱い、境界値
2. **セキュリティ** — 認証/認可の抜け、入力バリデーション、SQL インジェクション、XSS、CSRF、機密情報漏洩
3. **データ整合性** — DB スキーマ設計、外部キー制約、トランザクション、マイグレーション安全性
4. **パフォーマンス** — N+1 クエリ、不要な再レンダリング、インデックス不足、大量データの扱い
5. **型安全性** — TypeScript strict 違反、any の乱用、型の不整合
6. **コード品質** — 可読性、重複、責務の分離、命名、テスタビリティ
7. **既存パターン準拠** — プロジェクト内の確立したパターンから逸脱していないか

### プロジェクト固有の注意点

- モノレポ: `apps/web` (Next.js 15 App Router) + `apps/api` (Hono) + `packages/shared` (Drizzle ORM + 型) + `apps/mail-worker` (IMAP fetcher + AI classifier + cron)
- 認証: Auth.js v5 LINE認証、招待制、RBAC 3層（admin / vice_admin / member）
- フロントは Server Components + Server Actions で DB 直接操作
- Tailwind v4 + 自前 UI primitives（Btn / Card / Pill 等、shadcn は未導入）
- テスト: Vitest（unit + integration）+ Playwright（E2E）+ test DB（drizzle-kit push --force）

### 本 PR 固有の文脈

- **Phase P3-A メール大会取り込み** の最終 PR（PR1-PR4 で実装済み: IMAP fetcher / 添付テキスト化 / AI 抽出 / 承認 UI）
- 本 PR の追加: (1) `mail_worker_runs/jobs` 永続化 (2) `@line/bot-sdk ^11.0.0` push 通知 (3) 手動取り込みボタン + ジョブキュー (4) systemd unit + デプロイ手順書
- 全 8 件の grill-me 質問は確定済み（plan の Q1-Q8 参照）。**plan に書かれた設計判断 (= scope) から外れる要望は今回スコープ外として扱ってよい**
- スコープ外: LINE グループ転送 (P3-B 候補) / 対象外大会の自動はじき (運用 3-6 ヶ月後) / 進捗ポーリング UI (v1 では toast のみ)

### 出力形式

以下の形式で結果を返してください:

```markdown
## 総評
（全体の所感、マージして良いか、ブロッカーの有無）

## 指摘事項

### 🔴 Blocker（マージ前に必須で修正）
- **[ファイル:行]** 指摘内容
  - 根拠: なぜ問題か
  - 提案: 具体的な修正案

### 🟡 Should fix（強く推奨）
- 同上

### 🟢 Nits / 提案（任意対応）
- 同上

## 良かった点
（任意、既存パターン踏襲の成功例など）
```

---

## 差分

以下が `git diff main...feat/mail-tournament-import-pr5` の出力です。

**注意**: `packages/shared/drizzle/meta/0010_snapshot.json` (1884 行) は drizzle-kit が自動生成するスキーマ snapshot。レビュー対象は実 SQL (`packages/shared/drizzle/0010_panoramic_rattler.sql`) と TypeScript 側のスキーマ定義 (`packages/shared/src/schema/*.ts`) で十分。snapshot.json は SQL と整合していれば skip 可。

```diff
diff --git a/apps/mail-worker/package.json b/apps/mail-worker/package.json
index 25dd1f4..dc2db1c 100644
--- a/apps/mail-worker/package.json
+++ b/apps/mail-worker/package.json
@@ -24,6 +24,7 @@
   "dependencies": {
     "@anthropic-ai/sdk": "^0.91.1",
     "@kagetra/shared": "workspace:*",
+    "@line/bot-sdk": "^11.0.0",
     "dotenv": "^16.4.0",
     "drizzle-orm": "0.45.2",
     "imapflow": "^1.0.0",
diff --git a/apps/mail-worker/scripts/seed-system-channel.ts b/apps/mail-worker/scripts/seed-system-channel.ts
new file mode 100644
index 0000000..23b707f
--- /dev/null
+++ b/apps/mail-worker/scripts/seed-system-channel.ts
@@ -0,0 +1,280 @@
+#!/usr/bin/env -S tsx
+/**
+ * Seed or rotate the `line_channels` row with `status='system'`.
+ *
+ * Idempotent: if a system row exists, UPDATE the access_token / bot_id /
+ * notification_user_id (token rotation 用途). Otherwise INSERT.
+ *
+ * Args (env fallback in `LINE_SYSTEM_*`):
+ *   --channel-id=...                   (LINE_SYSTEM_CHANNEL_ID)        required
+ *   --channel-secret=...               (LINE_SYSTEM_CHANNEL_SECRET)    required
+ *   --access-token=...                 (LINE_SYSTEM_CHANNEL_ACCESS_TOKEN) required
+ *   --bot-id=...                       (LINE_SYSTEM_BOT_ID)            required
+ *   --notification-line-user-id=...    (LINE_SYSTEM_NOTIFICATION_USER_ID) optional
+ *   --note=...                         (任意)                          optional
+ *   --dry-run                          UPDATE/INSERT を print のみ、commit しない
+ *   --help / -h                        usage 表示
+ *
+ * Usage:
+ *   pnpm --filter @kagetra/mail-worker exec tsx scripts/seed-system-channel.ts \
+ *     --channel-id=2007xxxx --channel-secret=... --access-token=... \
+ *     --bot-id=@xxxx --notification-line-user-id=Uxxxxxxxx
+ *
+ * Or with env file already sourced:
+ *   pnpm --filter @kagetra/mail-worker exec tsx scripts/seed-system-channel.ts
+ */
+import { pathToFileURL } from 'node:url'
+import { eq } from 'drizzle-orm'
+import { lineChannels } from '@kagetra/shared/schema'
+import { closeDb, getDb } from '../src/db.js'
+
+interface SeedArgs {
+  channelId: string
+  channelSecret: string
+  accessToken: string
+  botId: string
+  notificationLineUserId: string | null
+  note: string | null
+  dryRun: boolean
+  help: boolean
+}
+
+interface RawArgs {
+  channelId: string | null
+  channelSecret: string | null
+  accessToken: string | null
+  botId: string | null
+  notificationLineUserId: string | null
+  note: string | null
+  dryRun: boolean
+  help: boolean
+}
+
+function printUsage(): void {
+  // eslint-disable-next-line no-console
+  console.log(`Usage: tsx apps/mail-worker/scripts/seed-system-channel.ts [options]
+
+Seed or rotate the line_channels row with status='system'. Idempotent:
+existing system row is UPDATE'd (token rotation 用途), absent row is INSERT'd.
+
+Required (env fallback in parens):
+  --channel-id=<id>                     (LINE_SYSTEM_CHANNEL_ID)
+  --channel-secret=<secret>             (LINE_SYSTEM_CHANNEL_SECRET)
+  --access-token=<token>                (LINE_SYSTEM_CHANNEL_ACCESS_TOKEN)
+  --bot-id=<bot-id>                     (LINE_SYSTEM_BOT_ID)
+
+Optional:
+  --notification-line-user-id=<userId>  (LINE_SYSTEM_NOTIFICATION_USER_ID)
+                                        admin's LINE userId for push targets.
+                                        未指定時は通知が skip される。
+  --note=<text>                         freeform memo (DB column line_channels.note)
+  --dry-run                             print intended INSERT/UPDATE; no commit
+  --help, -h                            show this help
+
+Requires DATABASE_URL in env (loaded via dotenv from repo root).
+`)
+}
+
+/**
+ * Parse argv + env into a raw set (nullable). Validation happens in
+ * `validateArgs` so `--help` / `--dry-run` can short-circuit before we yell
+ * about missing required fields.
+ *
+ * Unknown flags fail loudly — a typo like `--notification-line-userid` would
+ * otherwise silently fall back to env (or null) and the operator would think
+ * the row was seeded with their argument when it wasn't.
+ */
+function parseArgs(argv: readonly string[]): RawArgs {
+  const raw: RawArgs = {
+    channelId: process.env.LINE_SYSTEM_CHANNEL_ID ?? null,
+    channelSecret: process.env.LINE_SYSTEM_CHANNEL_SECRET ?? null,
+    accessToken: process.env.LINE_SYSTEM_CHANNEL_ACCESS_TOKEN ?? null,
+    botId: process.env.LINE_SYSTEM_BOT_ID ?? null,
+    notificationLineUserId:
+      process.env.LINE_SYSTEM_NOTIFICATION_USER_ID ?? null,
+    note: null,
+    dryRun: false,
+    help: false,
+  }
+  for (const a of argv) {
+    if (a === '--help' || a === '-h') {
+      raw.help = true
+    } else if (a === '--dry-run') {
+      raw.dryRun = true
+    } else if (a.startsWith('--channel-id=')) {
+      raw.channelId = a.slice('--channel-id='.length)
+    } else if (a.startsWith('--channel-secret=')) {
+      raw.channelSecret = a.slice('--channel-secret='.length)
+    } else if (a.startsWith('--access-token=')) {
+      raw.accessToken = a.slice('--access-token='.length)
+    } else if (a.startsWith('--bot-id=')) {
+      raw.botId = a.slice('--bot-id='.length)
+    } else if (a.startsWith('--notification-line-user-id=')) {
+      raw.notificationLineUserId = a.slice(
+        '--notification-line-user-id='.length,
+      )
+    } else if (a.startsWith('--note=')) {
+      raw.note = a.slice('--note='.length)
+    } else {
+      throw new Error(`unknown flag: ${a}`)
+    }
+  }
+  return raw
+}
+
+function validateArgs(raw: RawArgs): SeedArgs {
+  const missing: string[] = []
+  if (!raw.channelId) missing.push('--channel-id (or LINE_SYSTEM_CHANNEL_ID)')
+  if (!raw.channelSecret)
+    missing.push('--channel-secret (or LINE_SYSTEM_CHANNEL_SECRET)')
+  if (!raw.accessToken)
+    missing.push('--access-token (or LINE_SYSTEM_CHANNEL_ACCESS_TOKEN)')
+  if (!raw.botId) missing.push('--bot-id (or LINE_SYSTEM_BOT_ID)')
+  if (missing.length > 0) {
+    throw new Error(`missing required args: ${missing.join(', ')}`)
+  }
+  // After the missing-check, the four required fields are non-null. The
+  // explicit `as string` keeps strict mode + noUncheckedIndexedAccess happy
+  // without broadening the SeedArgs type.
+  return {
+    channelId: raw.channelId as string,
+    channelSecret: raw.channelSecret as string,
+    accessToken: raw.accessToken as string,
+    botId: raw.botId as string,
+    notificationLineUserId: raw.notificationLineUserId,
+    note: raw.note,
+    dryRun: raw.dryRun,
+    help: raw.help,
+  }
+}
+
+/**
+ * Redact secrets before logging. The dry-run path prints the would-be values
+ * for operator verification; we strip access_token + channel_secret because
+ * a copy-paste of journalctl output into Slack/issue comments would leak
+ * them otherwise.
+ */
+function redactForLog(args: SeedArgs): Record<string, unknown> {
+  return {
+    channelId: args.channelId,
+    channelSecret: '<redacted>',
+    accessToken: '<redacted>',
+    botId: args.botId,
+    notificationLineUserId: args.notificationLineUserId,
+    note: args.note,
+  }
+}
+
+export async function runSeed(args: SeedArgs): Promise<'inserted' | 'updated' | 'dry-run-insert' | 'dry-run-update'> {
+  const db = getDb()
+  try {
+    const existing = await db
+      .select({ id: lineChannels.id })
+      .from(lineChannels)
+      .where(eq(lineChannels.status, 'system'))
+
+    if (args.dryRun) {
+      if (existing.length === 0) {
+        // eslint-disable-next-line no-console
+        console.log('[dry-run] would INSERT new system channel:')
+        // eslint-disable-next-line no-console
+        console.log(redactForLog(args))
+        return 'dry-run-insert'
+      }
+      // eslint-disable-next-line no-console
+      console.log(
+        `[dry-run] would UPDATE existing system channel id=${existing[0]?.id ?? '<unknown>'}:`,
+      )
+      // eslint-disable-next-line no-console
+      console.log(redactForLog(args))
+      return 'dry-run-update'
+    }
+
+    if (existing.length === 0) {
+      await db.insert(lineChannels).values({
+        channelId: args.channelId,
+        channelSecret: args.channelSecret,
+        channelAccessToken: args.accessToken,
+        botId: args.botId,
+        status: 'system',
+        notificationLineUserId: args.notificationLineUserId,
+        note: args.note,
+      })
+      // eslint-disable-next-line no-console
+      console.log('Inserted new system channel')
+      return 'inserted'
+    }
+
+    await db
+      .update(lineChannels)
+      .set({
+        channelId: args.channelId,
+        channelSecret: args.channelSecret,
+        channelAccessToken: args.accessToken,
+        botId: args.botId,
+        notificationLineUserId: args.notificationLineUserId,
+        note: args.note,
+        updatedAt: new Date(),
+      })
+      .where(eq(lineChannels.status, 'system'))
+    // eslint-disable-next-line no-console
+    console.log(
+      `Updated existing system channel id=${existing[0]?.id ?? '<unknown>'}`,
+    )
+    return 'updated'
+  } finally {
+    await closeDb()
+  }
+}
+
+async function main(): Promise<number> {
+  let raw: RawArgs
+  try {
+    raw = parseArgs(process.argv.slice(2))
+  } catch (err) {
+    process.stderr.write(
+      `error: ${err instanceof Error ? err.message : String(err)}\n\n`,
+    )
+    printUsage()
+    return 1
+  }
+  if (raw.help) {
+    printUsage()
+    return 0
+  }
+  let args: SeedArgs
+  try {
+    args = validateArgs(raw)
+  } catch (err) {
+    process.stderr.write(
+      `error: ${err instanceof Error ? err.message : String(err)}\n\n`,
+    )
+    printUsage()
+    return 1
+  }
+  await runSeed(args)
+  return 0
+}
+
+// Entrypoint guard. Equivalent to Python's `if __name__ == '__main__':` —
+// allows tests / other scripts to import this module without auto-running
+// the CLI. `pathToFileURL` produces the canonical `file://` form for the
+// current platform: `file:///C:/path/to/x.ts` on Windows,
+// `file:///path/to/x.ts` on POSIX. Hand-rolled slash counts got it wrong on
+// Windows (PR3 r3 review) — the CLI silently exited 0 instead of running.
+if (
+  process.argv[1] &&
+  pathToFileURL(process.argv[1]).href === import.meta.url
+) {
+  main()
+    .then((code) => {
+      process.exit(code)
+    })
+    .catch((err) => {
+      // eslint-disable-next-line no-console
+      console.error('[seed-system-channel] fatal:', err)
+      process.exit(1)
+    })
+}
+
+export { main as runSeedCli, parseArgs, validateArgs }
diff --git a/apps/mail-worker/src/index.ts b/apps/mail-worker/src/index.ts
index 4f31f91..903bfed 100644
--- a/apps/mail-worker/src/index.ts
+++ b/apps/mail-worker/src/index.ts
@@ -1,11 +1,12 @@
 import { readFile, readdir, stat } from 'node:fs/promises'
 import { join } from 'node:path'
 import { fileURLToPath } from 'node:url'
-import { runPipeline } from './pipeline.js'
+import { runOnce } from './pipeline.js'
 import { FixtureMailSource } from './fetch/fetcher.js'
-import { closeDb } from './db.js'
+import { closeDb, getDb } from './db.js'
 import { loadLogConfig, loadLlmConfig } from './config.js'
 import { parseSinceArg } from './cli-args.js'
+import { claimNextJob, markJobDone, markJobFailed } from './jobs.js'
 import { FixtureLLMExtractor, loadFixturesFromDir } from './classify/llm/fixture.js'
 import { AnthropicSonnet46Extractor } from './classify/llm/anthropic.js'
 import type { LLMExtractor } from './classify/llm/types.js'
@@ -22,6 +23,11 @@ interface CliFlags {
   mockImap: boolean
   mockLlm: boolean
   dryRun: boolean
+  /**
+   * PR5: skip the `mail_worker_jobs` claim step and run a pure cron tick.
+   * Used by tests / smoke / debug to exercise the legacy code path.
+   */
+  noClaim: boolean
   fixtureDir: string | undefined
 }
 
@@ -40,6 +46,7 @@ function parseArgs(argv: readonly string[]): CliFlags {
     mockImap: false,
     mockLlm: false,
     dryRun: false,
+    noClaim: false,
     fixtureDir: undefined,
   }
   for (const arg of argv) {
@@ -47,6 +54,7 @@ function parseArgs(argv: readonly string[]): CliFlags {
     else if (arg === '--mock-imap') flags.mockImap = true
     else if (arg === '--mock-llm') flags.mockLlm = true
     else if (arg === '--dry-run') flags.dryRun = true
+    else if (arg === '--no-claim') flags.noClaim = true
     else if (arg.startsWith('--since=')) {
       const value = arg.slice('--since='.length)
       flags.since = parseSinceArg(value)
@@ -79,6 +87,7 @@ function printUsage(): void {
                          instead of Anthropic. Skips ANTHROPIC_API_KEY validation.
   --fixture-dir=PATH     Directory of *.eml files for --mock-imap (default: ./test/fixtures).
   --dry-run              Parse only; do not write to DB or call the LLM.
+  --no-claim             Skip mail_worker_jobs claim and run a pure cron tick (test/debug).
   --help, -h             Show this help.
 `)
 }
@@ -106,35 +115,92 @@ async function main(): Promise<void> {
   //   default      → AnthropicSonnet46Extractor (loadLlmConfig validates env)
   const llmExtractor = await buildLlmExtractor(flags)
 
+  // Build the IMAP source: `--mock-imap` reads fixture eml files; otherwise
+  // we let `runPipeline` instantiate a `LiveMailSource` (via the default).
+  let source: FixtureMailSource | undefined
   if (flags.mockImap) {
     const dir = flags.fixtureDir
       ?? join(fileURLToPath(new URL('..', import.meta.url)), 'test', 'fixtures')
     const fixtures = await loadFixtureBuffers(dir)
-    const source = new FixtureMailSource(fixtures)
-    const summary = await runPipeline({
-      since: flags.since,
+    source = new FixtureMailSource(fixtures)
+  }
+
+  // Default lookback for cron / live IMAP. Logged the first time we apply it
+  // so operators know why a manual `pnpm start` looks at the last 7 days.
+  const cronSince = flags.since ?? defaultLiveSince()
+  if (!flags.since && !flags.mockImap) {
+    // eslint-disable-next-line no-console
+    console.log(
+      `[mail-worker] --since not provided; defaulting to last ${LIVE_DEFAULT_SINCE_DAYS} days (since=${cronSince.toISOString()}). Pass --since=YYYY-MM-DD to override.`,
+    )
+  }
+
+  const log = consoleLogger()
+
+  // Dispatcher: `--no-claim` skips the queue entirely (test/debug); `--dry-run`
+  // also skips it because runOnce would write a `mail_worker_runs` row, which
+  // a dry-run shouldn't do. Otherwise, try to claim a pending admin job; if
+  // none, fall through to a cron tick.
+  if (flags.noClaim || flags.dryRun) {
+    const summary = await runOnce({
+      kind: 'cron',
+      since: flags.mockImap ? flags.since : cronSince,
       source,
       dryRun: flags.dryRun,
-      logger: consoleLogger(),
+      logger: log,
       llmExtractor,
     })
     // eslint-disable-next-line no-console
     console.log('pipeline summary:', summary)
-  } else {
-    // Live IMAP without --since used to scan the full INBOX (`{ all: true }`)
-    // and pull every body/attachment into memory. Default to the last
-    // LIVE_DEFAULT_SINCE_DAYS so a stray `pnpm start` can't blow up the worker.
-    const effectiveSince = flags.since ?? defaultLiveSince()
-    if (!flags.since) {
+    await closeDb()
+    return
+  }
+
+  const db = getDb()
+  const job = await claimNextJob(db).catch((err) => {
+    log.warn('claimNextJob failed; falling back to cron tick', {
+      err: err instanceof Error ? err.message : String(err),
+    })
+    return null
+  })
+
+  if (job) {
+    log.info('claimed mail_worker_jobs row', {
+      jobId: job.id,
+      requestedByUserId: job.requestedByUserId,
+      since: job.since?.toISOString() ?? null,
+    })
+    try {
+      const summary = await runOnce({
+        kind: 'manual',
+        triggeredByUserId: job.requestedByUserId,
+        since: job.since ?? cronSince,
+        source,
+        logger: log,
+        llmExtractor,
+      })
+      await markJobDone(db, job.id, summary.runId)
       // eslint-disable-next-line no-console
-      console.log(
-        `[mail-worker] --since not provided; defaulting to last ${LIVE_DEFAULT_SINCE_DAYS} days (since=${effectiveSince.toISOString()}). Pass --since=YYYY-MM-DD to override.`,
-      )
+      console.log('pipeline summary:', summary)
+    } catch (err) {
+      // runOnce may throw on top-level IMAP failure; the run row is already
+      // persisted with status=imap_failed inside runOnce. Mark the job
+      // failed so the admin sees the error in the inbox UI.
+      const message = err instanceof Error ? err.message : String(err)
+      await markJobFailed(db, job.id, message).catch((markErr) => {
+        log.warn('markJobFailed also failed', {
+          jobId: job.id,
+          err: markErr instanceof Error ? markErr.message : String(markErr),
+        })
+      })
+      throw err
     }
-    const summary = await runPipeline({
-      since: effectiveSince,
-      dryRun: flags.dryRun,
-      logger: consoleLogger(),
+  } else {
+    const summary = await runOnce({
+      kind: 'cron',
+      since: cronSince,
+      source,
+      logger: log,
       llmExtractor,
     })
     // eslint-disable-next-line no-console
diff --git a/apps/mail-worker/src/jobs.ts b/apps/mail-worker/src/jobs.ts
new file mode 100644
index 0000000..16a3fec
--- /dev/null
+++ b/apps/mail-worker/src/jobs.ts
@@ -0,0 +1,110 @@
+import { and, asc, eq, sql } from 'drizzle-orm'
+import { mailWorkerJobs } from '@kagetra/shared/schema'
+import type { Db } from './db.js'
+
+/**
+ * `mail_worker_jobs` queue ops for the dispatcher (PR5 Phase 3c).
+ *
+ * The queue is single-consumer in the production cron model — only one
+ * mail-worker process runs at a time — but `claimNextJob` still uses
+ * `FOR UPDATE SKIP LOCKED` so a future move to multiple workers (or a
+ * concurrent `--once` invocation) can't double-execute the same job.
+ *
+ * The claim runs inside a short transaction (SELECT…FOR UPDATE + UPDATE),
+ * deliberately separate from the pipeline's main DB activity which would
+ * hold the transaction open while IMAP / Anthropic round-trip.
+ */
+
+export type ClaimedJob = {
+  id: number
+  requestedByUserId: string
+  /** `--since` cutoff requested by the admin, or null for default lookback. */
+  since: Date | null
+  requestedAt: Date
+}
+
+/**
+ * Atomically pick the oldest pending job and mark it `claimed`. Returns
+ * `null` if no pending jobs are available — the caller falls back to a
+ * regular cron tick.
+ *
+ * Implementation note: Drizzle's `.for('update', { skipLocked: true })`
+ * generates `FOR UPDATE SKIP LOCKED`, the standard Postgres pattern for a
+ * non-blocking queue claim. The SELECT and UPDATE both live inside the same
+ * transaction so the row's lock is released only after the status flip
+ * commits — no other worker can see it as pending.
+ */
+export async function claimNextJob(db: Db): Promise<ClaimedJob | null> {
+  return db.transaction(async (tx) => {
+    const candidates = await tx
+      .select({
+        id: mailWorkerJobs.id,
+        requestedByUserId: mailWorkerJobs.requestedByUserId,
+        since: mailWorkerJobs.since,
+        requestedAt: mailWorkerJobs.requestedAt,
+      })
+      .from(mailWorkerJobs)
+      .where(eq(mailWorkerJobs.status, 'pending'))
+      .orderBy(asc(mailWorkerJobs.requestedAt))
+      .limit(1)
+      .for('update', { skipLocked: true })
+    if (candidates.length === 0) return null
+    const candidate = candidates[0]!
+
+    const updated = await tx
+      .update(mailWorkerJobs)
+      .set({ status: 'claimed', claimedAt: sql`now()` })
+      .where(and(eq(mailWorkerJobs.id, candidate.id), eq(mailWorkerJobs.status, 'pending')))
+      .returning({
+        id: mailWorkerJobs.id,
+        requestedByUserId: mailWorkerJobs.requestedByUserId,
+        since: mailWorkerJobs.since,
+        requestedAt: mailWorkerJobs.requestedAt,
+      })
+    if (updated.length === 0) {
+      // Should be impossible while we hold the row lock, but stay defensive
+      // — return null so the dispatcher falls back to a cron run.
+      return null
+    }
+    const row = updated[0]!
+    return {
+      id: row.id,
+      requestedByUserId: row.requestedByUserId,
+      since: row.since,
+      requestedAt: row.requestedAt,
+    }
+  })
+}
+
+/**
+ * Mark a successfully executed job as `done` and link the produced run id.
+ * `runId` is required here — a successful execution must have created a run.
+ */
+export async function markJobDone(
+  db: Db,
+  jobId: number,
+  runId: number,
+): Promise<void> {
+  await db
+    .update(mailWorkerJobs)
+    .set({ status: 'done', runId, error: null })
+    .where(eq(mailWorkerJobs.id, jobId))
+}
+
+/**
+ * Mark a failed job. `runId` is nullable because a job can fail BEFORE the
+ * `mail_worker_runs` row was inserted (e.g. dispatcher crashed between claim
+ * and run-row creation). When provided it points at the run row that
+ * captured the error in detail.
+ */
+export async function markJobFailed(
+  db: Db,
+  jobId: number,
+  error: string,
+  runId: number | null = null,
+): Promise<void> {
+  await db
+    .update(mailWorkerJobs)
+    .set({ status: 'failed', error, runId })
+    .where(eq(mailWorkerJobs.id, jobId))
+}
diff --git a/apps/mail-worker/src/notify/line.ts b/apps/mail-worker/src/notify/line.ts
new file mode 100644
index 0000000..2d0ed77
--- /dev/null
+++ b/apps/mail-worker/src/notify/line.ts
@@ -0,0 +1,160 @@
+import { desc, eq } from 'drizzle-orm'
+import { messagingApi } from '@line/bot-sdk'
+import { lineChannels } from '@kagetra/shared/schema'
+import type { Db } from '../db.js'
+
+/**
+ * Thin wrapper around `@line/bot-sdk` v11 for the mail-worker's admin
+ * notification path. Scope:
+ *
+ *   - Look up the single `status='system'` row in `line_channels` (PR5 plan
+ *     Q6: provisioned via `seed-system-channel.ts`, mutated only on access
+ *     token rotation).
+ *   - Push a free-form text message to the configured admin LINE userId.
+ *   - Hide SDK exception types behind `LineNotifyError` so the pipeline can
+ *     continue (per PR5 plan note: "401 token invalid → log only, pipeline
+ *     continue").
+ *   - Honour `LINE_NOTIFY_DRY_RUN=1` for tests / CI / local smoke runs that
+ *     should exercise the wiring without actually hitting the LINE API.
+ *
+ * The v11 SDK exposes `messagingApi.MessagingApiClient` whose
+ * `pushMessage({ to, messages: [...] })` is the supported entry point. We
+ * intentionally take the same `Db` handle the pipeline already carries
+ * (Pool-backed Drizzle client) so notify is callable from inside or outside a
+ * transaction without spinning a second pool.
+ */
+
+export type SystemChannel = {
+  channelAccessToken: string
+  botId: string
+  notificationLineUserId: string | null
+}
+
+export interface NotifyLogger {
+  info(msg: string, ctx?: Record<string, unknown>): void
+  warn(msg: string, ctx?: Record<string, unknown>): void
+}
+
+const NOOP_LOGGER: NotifyLogger = {
+  info: () => undefined,
+  warn: () => undefined,
+}
+
+/**
+ * Thrown when no `line_channels` row with `status='system'` exists. The
+ * mail-worker treats this as a fatal config error on the notify path: the
+ * pipeline still completes (drafts are persisted), but the admin alert is
+ * skipped and the caller logs the missing-channel state.
+ */
+export class LineSystemChannelNotConfiguredError extends Error {
+  constructor() {
+    super(
+      'No line_channels row with status=system found. Seed one via apps/mail-worker/scripts/seed-system-channel.ts.',
+    )
+    this.name = 'LineSystemChannelNotConfiguredError'
+  }
+}
+
+/**
+ * Wraps any error thrown by the LINE SDK (HTTP error, network error, JSON
+ * parse error). The `cause` field preserves the original error so callers /
+ * tests can inspect status codes (HTTPFetchError) when needed.
+ */
+export class LineNotifyError extends Error {
+  override readonly cause: unknown
+  constructor(message: string, cause: unknown) {
+    super(message)
+    this.name = 'LineNotifyError'
+    this.cause = cause
+  }
+}
+
+export interface PushSystemNotificationResult {
+  skipped: boolean
+  reason?: string
+}
+
+/**
+ * Fetch the `status='system'` channel row. If multiple rows exist (operator
+ * mistake), pick the most recently updated one and warn — preserving the
+ * latest rotation rather than blowing up.
+ */
+export async function getSystemChannel(
+  db: Db,
+  logger: NotifyLogger = NOOP_LOGGER,
+): Promise<SystemChannel> {
+  const rows = await db
+    .select({
+      channelAccessToken: lineChannels.channelAccessToken,
+      botId: lineChannels.botId,
+      notificationLineUserId: lineChannels.notificationLineUserId,
+      updatedAt: lineChannels.updatedAt,
+    })
+    .from(lineChannels)
+    .where(eq(lineChannels.status, 'system'))
+    .orderBy(desc(lineChannels.updatedAt))
+
+  if (rows.length === 0) {
+    throw new LineSystemChannelNotConfiguredError()
+  }
+  if (rows.length > 1) {
+    logger.warn('multiple line_channels with status=system found; using most recent', {
+      count: rows.length,
+    })
+  }
+  const row = rows[0]!
+  return {
+    channelAccessToken: row.channelAccessToken,
+    botId: row.botId,
+    notificationLineUserId: row.notificationLineUserId,
+  }
+}
+
+/**
+ * Push a text message to the system channel's configured admin userId.
+ *
+ * Returns `{ skipped: true, reason }` for the two non-error skip paths:
+ *   - `no-user-id`: channel was seeded but the admin hasn't been resolved
+ *     yet (LINE Login webhook not wired — that's a P3-B follow-up).
+ *   - `dry-run`: `LINE_NOTIFY_DRY_RUN=1` is set; we log and skip the network
+ *     call. Useful for tests, CI smoke, and local pipeline replays.
+ *
+ * On real failures (SDK throw) we wrap into `LineNotifyError`; the pipeline
+ * caller is expected to catch and log without aborting the run.
+ */
+export async function pushSystemNotification(
+  db: Db,
+  message: string,
+  logger: NotifyLogger = NOOP_LOGGER,
+): Promise<PushSystemNotificationResult> {
+  const channel = await getSystemChannel(db, logger)
+
+  if (!channel.notificationLineUserId) {
+    logger.warn('LINE system channel is missing notification_line_user_id; skipping push', {
+      botId: channel.botId,
+    })
+    return { skipped: true, reason: 'no-user-id' }
+  }
+
+  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {
+    logger.info('LINE_NOTIFY_DRY_RUN=1; skipping real push', {
+      to: channel.notificationLineUserId,
+      preview: message.slice(0, 200),
+    })
+    return { skipped: true, reason: 'dry-run' }
+  }
+
+  const client = new messagingApi.MessagingApiClient({
+    channelAccessToken: channel.channelAccessToken,
+  })
+
+  try {
+    await client.pushMessage({
+      to: channel.notificationLineUserId,
+      messages: [{ type: 'text', text: message }],
+    })
+    return { skipped: false }
+  } catch (err) {
+    throw new LineNotifyError('LINE pushMessage failed', err)
+  }
+}
diff --git a/apps/mail-worker/src/notify/message-templates.ts b/apps/mail-worker/src/notify/message-templates.ts
new file mode 100644
index 0000000..563c8c4
--- /dev/null
+++ b/apps/mail-worker/src/notify/message-templates.ts
@@ -0,0 +1,82 @@
+/**
+ * LINE notification message templates for the mail-worker.
+ *
+ * These functions are pure string builders — no I/O, no DB. The pipeline
+ * (PR5 Phase 3) calls them from `pushSystemNotification(db, message)` when a
+ * cron run produces new drafts or when consecutive failure thresholds trip.
+ *
+ * Format choices come from the PR5 grill-me (2026-04-28):
+ *   - Q4: top 5 subjects listed, surplus collapsed to `他 M 件`
+ *   - Common footer `→ /admin/mail-inbox` so the admin can deep-link from LINE
+ *   - Error-message tail truncated to 200 Unicode code points (not UTF-16 code
+ *     units) so combining characters and astral-plane glyphs (rare in IMAP
+ *     errors but cheap to handle correctly) don't cut mid-character.
+ */
+
+const INBOX_LINK = '→ /admin/mail-inbox'
+const NEW_DRAFTS_TOP_LIMIT = 5
+const ERROR_DETAIL_MAX = 200
+
+export interface NewDraftsMessageInput {
+  drafts: { subject: string }[]
+}
+
+/**
+ * Build the "新規大会案内 N 件" notification body. The pipeline only calls this
+ * when N >= 1, so a 0-length input is a programmer error and we throw rather
+ * than emit a misleading "0 件" message that would still ping the admin.
+ */
+export function buildNewDraftsMessage({ drafts }: NewDraftsMessageInput): string {
+  if (drafts.length === 0) {
+    throw new Error('buildNewDraftsMessage requires at least one draft')
+  }
+  const total = drafts.length
+  const lines: string[] = [`📬 新規大会案内 ${total} 件を取り込みました`]
+  const head = drafts.slice(0, NEW_DRAFTS_TOP_LIMIT)
+  for (const draft of head) {
+    lines.push(`・${draft.subject}`)
+  }
+  if (total > NEW_DRAFTS_TOP_LIMIT) {
+    const overflow = total - NEW_DRAFTS_TOP_LIMIT
+    lines.push(`他 ${overflow} 件`)
+  }
+  lines.push(INBOX_LINK)
+  return lines.join('\n')
+}
+
+export interface ErrorMessageInput {
+  kind: 'imap' | 'ai'
+  recentRuns: number
+  lastError: string
+}
+
+/**
+ * Build the consecutive-failure alert body. `kind` selects the headline; the
+ * `lastError` payload is appended on its own line, truncated to keep LINE
+ * messages well under the 5,000-character push limit even when the upstream
+ * error includes a stack trace or a Yahoo IMAP server response dump.
+ *
+ * Truncation is by Unicode code point (Array.from(...).length), not by
+ * `string.length`, so a Japanese error blurb that lands exactly on the
+ * boundary doesn't get an orphaned high surrogate appended.
+ */
+export function buildErrorMessage({
+  kind,
+  recentRuns,
+  lastError,
+}: ErrorMessageInput): string {
+  const headline =
+    kind === 'imap'
+      ? `⚠️ メール取り込みが連続 ${recentRuns} 回 IMAP エラーで失敗しています`
+      : `⚠️ AI 抽出が連続 ${recentRuns} 件失敗しています`
+  const truncatedDetail = truncateByCodePoint(lastError, ERROR_DETAIL_MAX)
+  return [headline, truncatedDetail, INBOX_LINK].join('\n')
+}
+
+function truncateByCodePoint(input: string, max: number): string {
+  // Array spread iterates code points (handles surrogate pairs correctly), so
+  // a string of, say, 199 Japanese chars + one emoji counts as 200 not 201.
+  const codepoints = Array.from(input)
+  if (codepoints.length <= max) return input
+  return codepoints.slice(0, max).join('') + '…'
+}
diff --git a/apps/mail-worker/src/notify/orchestrator.ts b/apps/mail-worker/src/notify/orchestrator.ts
new file mode 100644
index 0000000..da38c80
--- /dev/null
+++ b/apps/mail-worker/src/notify/orchestrator.ts
@@ -0,0 +1,219 @@
+import { and, desc, eq } from 'drizzle-orm'
+import { mailWorkerRuns } from '@kagetra/shared/schema'
+import type { Db } from '../db.js'
+import {
+  LineNotifyError,
+  type NotifyLogger,
+  pushSystemNotification,
+} from './line.js'
+import { buildErrorMessage, buildNewDraftsMessage } from './message-templates.js'
+
+/**
+ * The persisted shape of `mail_worker_runs.summary`. Mirrors the doc-comment
+ * in `pipeline.ts:runOnce` — kept here as a single source of truth so the
+ * notify orchestrator and the pipeline writer can't drift.
+ *
+ * All numeric counters default to 0; flags default to absent (undefined). The
+ * notification book-keeping flags (`notified_*_alert`) are written *after*
+ * the run row exists so consecutive-failure logic can scan the previous
+ * run's marker to suppress re-pings.
+ */
+export interface MailWorkerRunSummary {
+  fetched: number
+  classified: number
+  drafts_created: number
+  ai_failed: number
+  imap_error: boolean
+  errors: string[]
+  notified_imap_alert?: true
+  notified_ai_alert?: true
+  new_draft_subjects?: string[]
+}
+
+/**
+ * DI hook so tests can inject a `vi.fn()` instead of hitting the real LINE
+ * SDK. Default is `pushSystemNotification` which goes through the SDK +
+ * `LINE_NOTIFY_DRY_RUN` gating.
+ */
+export type Notifier = (
+  db: Db,
+  message: string,
+  logger?: NotifyLogger,
+) => Promise<unknown>
+
+const NOOP_LOGGER: NotifyLogger = {
+  info: () => undefined,
+  warn: () => undefined,
+}
+
+const CONSECUTIVE_RUN_WINDOW = 3
+const AI_FAILURE_THRESHOLD = 3
+
+/**
+ * After the pipeline finishes and the current run row is persisted, decide
+ * whether to push notifications and update the run summary's
+ * `notified_*_alert` markers.
+ *
+ * Three independent triggers, each gated to avoid spam:
+ *
+ *   1. **New drafts**: any positive `drafts_created` count → one push per
+ *      run with the top-5 subjects.
+ *   2. **IMAP consecutive failures**: 3 consecutive runs (including current)
+ *      with `imap_error=true`. Suppressed if the previous run already pinged
+ *      (`notified_imap_alert=true`). After pushing, the current run's
+ *      summary is patched to set `notified_imap_alert=true`.
+ *   3. **AI consecutive failures**: cumulative `ai_failed` >= 3 across the
+ *      last 3 runs. Same suppression / marker pattern.
+ *
+ * Notification SDK throws (`LineNotifyError`) are caught here and logged —
+ * a transient LINE outage must not roll back the pipeline run that already
+ * persisted drafts.
+ */
+export async function evaluateAndNotify(
+  db: Db,
+  runId: number,
+  logger: NotifyLogger = NOOP_LOGGER,
+  notifier: Notifier = pushSystemNotification,
+): Promise<void> {
+  const recent = await fetchRecentRuns(db, CONSECUTIVE_RUN_WINDOW)
+  const current = recent.find((r) => r.id === runId)
+  if (!current) {
+    // Defensive: a concurrent run delete shouldn't crash notify. Just bail.
+    logger.warn('evaluateAndNotify: current run not found in recent window', {
+      runId,
+    })
+    return
+  }
+  const currentSummary = (current.summary ?? {}) as MailWorkerRunSummary
+
+  // (1) New drafts
+  if ((currentSummary.drafts_created ?? 0) > 0) {
+    const subjects = currentSummary.new_draft_subjects ?? []
+    if (subjects.length > 0) {
+      await safeNotify(notifier, db, buildNewDraftsMessage({
+        drafts: subjects.map((subject) => ({ subject })),
+      }), logger)
+    }
+  }
+
+  // (2) IMAP consecutive failures.
+  const previous = recent.find((r) => r.id !== runId)
+  const prevSummary = previous
+    ? ((previous.summary ?? {}) as MailWorkerRunSummary)
+    : null
+
+  if (
+    recent.length >= CONSECUTIVE_RUN_WINDOW &&
+    recent.every((r) => ((r.summary ?? {}) as MailWorkerRunSummary).imap_error === true) &&
+    !(prevSummary?.notified_imap_alert === true)
+  ) {
+    const lastError = currentSummary.errors?.[0] ?? 'unknown IMAP error'
+    const sent = await safeNotify(
+      notifier,
+      db,
+      buildErrorMessage({
+        kind: 'imap',
+        recentRuns: CONSECUTIVE_RUN_WINDOW,
+        lastError,
+      }),
+      logger,
+    )
+    if (sent) {
+      await markAlertNotified(db, runId, currentSummary, 'imap')
+    }
+  }
+
+  // (3) AI consecutive failures.
+  const aiFailedCumulative = recent.reduce(
+    (acc, r) => acc + (((r.summary ?? {}) as MailWorkerRunSummary).ai_failed ?? 0),
+    0,
+  )
+  if (
+    recent.length >= CONSECUTIVE_RUN_WINDOW &&
+    aiFailedCumulative >= AI_FAILURE_THRESHOLD &&
+    !(prevSummary?.notified_ai_alert === true)
+  ) {
+    // Pull the last AI error string from the most recent run that had AI
+    // failures (current first, then walk back). Falls back to a generic
+    // string if all errors arrays are empty.
+    let lastError = 'unknown AI error'
+    for (const r of recent) {
+      const s = (r.summary ?? {}) as MailWorkerRunSummary
+      if ((s.ai_failed ?? 0) > 0 && s.errors && s.errors.length > 0) {
+        lastError = s.errors[s.errors.length - 1] ?? lastError
+        break
+      }
+    }
+    const sent = await safeNotify(
+      notifier,
+      db,
+      buildErrorMessage({
+        kind: 'ai',
+        recentRuns: aiFailedCumulative,
+        lastError,
+      }),
+      logger,
+    )
+    if (sent) {
+      await markAlertNotified(db, runId, currentSummary, 'ai')
+    }
+  }
+}
+
+async function fetchRecentRuns(db: Db, limit: number) {
+  return db
+    .select({
+      id: mailWorkerRuns.id,
+      summary: mailWorkerRuns.summary,
+      status: mailWorkerRuns.status,
+      startedAt: mailWorkerRuns.startedAt,
+    })
+    .from(mailWorkerRuns)
+    .orderBy(desc(mailWorkerRuns.startedAt))
+    .limit(limit)
+}
+
+async function safeNotify(
+  notifier: Notifier,
+  db: Db,
+  message: string,
+  logger: NotifyLogger,
+): Promise<boolean> {
+  try {
+    await notifier(db, message, logger)
+    return true
+  } catch (err) {
+    if (err instanceof LineNotifyError) {
+      logger.warn('LINE notify failed; pipeline continues', {
+        message: err.message,
+        cause: err.cause instanceof Error ? err.cause.message : String(err.cause),
+      })
+      return false
+    }
+    // Non-LineNotifyError surface (e.g. system channel not configured) is
+    // also caught here — the pipeline must not abort because LINE is not
+    // wired yet. Log loudly so operators notice.
+    logger.warn('notifier threw unexpectedly; pipeline continues', {
+      err: err instanceof Error ? err.message : String(err),
+    })
+    return false
+  }
+}
+
+async function markAlertNotified(
+  db: Db,
+  runId: number,
+  currentSummary: MailWorkerRunSummary,
+  kind: 'imap' | 'ai',
+): Promise<void> {
+  const next: MailWorkerRunSummary = {
+    ...currentSummary,
+    ...(kind === 'imap'
+      ? { notified_imap_alert: true as const }
+      : { notified_ai_alert: true as const }),
+  }
+  await db
+    .update(mailWorkerRuns)
+    .set({ summary: next })
+    .where(and(eq(mailWorkerRuns.id, runId)))
+}
diff --git a/apps/mail-worker/src/pipeline.ts b/apps/mail-worker/src/pipeline.ts
index cb0b8a3..5f88e61 100644
--- a/apps/mail-worker/src/pipeline.ts
+++ b/apps/mail-worker/src/pipeline.ts
@@ -1,3 +1,5 @@
+import { and, eq, gte, inArray, sql } from 'drizzle-orm'
+import { mailMessages, mailWorkerRuns, tournamentDrafts } from '@kagetra/shared/schema'
 import { fetchMails, FixtureMailSource, LiveMailSource, type MailSource } from './fetch/fetcher.js'
 import type { ParsedAttachment, ParsedAttachmentSkip } from './fetch/imap-client.js'
 import { findByMessageId, insertMailMessage, updateStatus } from './persist/mail-message.js'
@@ -6,6 +8,11 @@ import { extractAttachment, type ExtractionStatus } from './extract/orchestrator
 import { getDb } from './db.js'
 import { classifyMail, persistOutcome } from './classify/classifier.js'
 import type { LLMExtractor } from './classify/llm/types.js'
+import {
+  evaluateAndNotify,
+  type MailWorkerRunSummary,
+  type Notifier,
+} from './notify/orchestrator.js'
 
 export interface PipelineSummary {
   /** Total mails seen by the source (parsed OK + parse failures). */
@@ -456,3 +463,207 @@ export async function runPipelineFromFixtures(
   const source = new FixtureMailSource(fixtures)
   return runPipeline({ ...opts, source })
 }
+
+// ─────────────────────────────────────────────────────────────────────────────
+// runOnce: PR5 Phase 3a wrapper
+//
+// Wraps `runPipeline` with mail_worker_runs persistence + notification
+// orchestration. The pipeline itself still does the IMAP/AI work; runOnce is
+// responsible for:
+//   1. Inserting a `running` row at the start.
+//   2. Running the pipeline (catch top-level errors so the row can still be
+//      finalized).
+//   3. Computing terminal status from the summary.
+//   4. UPDATEing the row with `summary`/`error`/`finished_at`/`status`.
+//   5. Calling `evaluateAndNotify` (which handles new-draft + consecutive-
+//      failure pings, with its own catch for LineNotifyError).
+//
+// Crucially, the runs INSERT/UPDATE happen OUTSIDE the per-mail transactions
+// — the same reason classify/persist run outside the mail-insert txn:
+// connection-pool contention with multi-second IMAP/Anthropic round trips.
+// ─────────────────────────────────────────────────────────────────────────────
+
+/** Limit `summary.errors` so a malformed mail batch can't blow up jsonb size. */
+const MAX_ERRORS_IN_SUMMARY = 10
+/** Cap subject list at 10 (the templates layer further trims to 5 for display). */
+const MAX_DRAFT_SUBJECTS = 10
+
+export interface RunOnceOptions extends RunPipelineOptions {
+  /** Distinguishes scheduler invocations from admin-requested ones. Default 'cron'. */
+  kind?: 'cron' | 'manual'
+  /** Set when this run was claimed from a `mail_worker_jobs` row. */
+  triggeredByUserId?: string | null
+  /**
+   * DI seam for tests: replace the LINE push with a `vi.fn()`. Defaults to
+   * the real `pushSystemNotification`.
+   */
+  notifier?: Notifier
+}
+
+export interface RunOnceResult extends PipelineSummary {
+  /** The `mail_worker_runs.id` of the row created for this invocation. */
+  runId: number
+}
+
+/**
+ * Top-level entry: insert a `mail_worker_runs` row, execute the pipeline,
+ * finalize the row, fire any LINE notifications, and return the run id +
+ * pipeline counters.
+ *
+ * Failure semantics:
+ *   - IMAP-only failure (top-level throw from `runPipeline`) → status
+ *     `'imap_failed'`, summary.imap_error=true.
+ *   - AI failures with at least one mail also classified successfully →
+ *     status `'partial'`.
+ *   - AI failures only, mail count > 0, no AI successes → `'ai_failed'`.
+ *   - Otherwise (incl. fetched=0 with no errors) → `'success'`.
+ *
+ * Any failure to UPDATE the run row at the end is rethrown — that's a real
+ * DB problem the cron / dispatcher should surface (exit 1). Notification
+ * failures are caught inside `evaluateAndNotify` and DO NOT affect the run.
+ */
+export async function runOnce(opts: RunOnceOptions = {}): Promise<RunOnceResult> {
+  const log = opts.logger ?? NOOP_LOGGER
+  const kind = opts.kind ?? 'cron'
+  const db = getDb()
+
+  // (1) Insert running row up front. We need its id so a crash later can be
+  // diagnosed by inspecting the orphaned `running` row.
+  const startedAt = new Date()
+  const inserted = await db
+    .insert(mailWorkerRuns)
+    .values({
+      startedAt,
+      kind,
+      status: 'running',
+      triggeredByUserId: opts.triggeredByUserId ?? null,
+      since: opts.since ?? null,
+    })
+    .returning({ id: mailWorkerRuns.id })
+  const runId = inserted[0]!.id
+
+  // (2) Execute pipeline. Catch top-level throws (IMAP fetch failure,
+  // connection refused, etc.) — anything per-mail is already isolated inside
+  // runPipeline.
+  let summary: PipelineSummary = emptySummary()
+  let topLevelError: Error | null = null
+  try {
+    summary = await runPipeline(opts)
+  } catch (err) {
+    topLevelError = err instanceof Error ? err : new Error(String(err))
+    log.warn('pipeline top-level error', {
+      runId,
+      err: topLevelError.message,
+    })
+  }
+
+  // (3) Compose summary jsonb. New draft subjects are looked up post-hoc
+  // (createdAt >= startedAt) so we don't have to thread them through the
+  // pipeline summary shape (which would risk regressing classifier tests).
+  const newDraftSubjects = summary.draftsInserted > 0
+    ? await fetchNewDraftSubjects(db, startedAt)
+    : []
+
+  const errors: string[] = []
+  if (topLevelError) errors.push(topLevelError.message)
+
+  const summaryJson: MailWorkerRunSummary = {
+    fetched: summary.fetched,
+    classified: summary.aiSucceeded + summary.aiFailed + summary.aiSkipped,
+    drafts_created: summary.draftsInserted,
+    ai_failed: summary.aiFailed,
+    imap_error: topLevelError !== null,
+    errors: errors.slice(0, MAX_ERRORS_IN_SUMMARY),
+    new_draft_subjects: newDraftSubjects.slice(0, MAX_DRAFT_SUBJECTS),
+  }
+
+  const status = computeRunStatus(summary, topLevelError !== null)
+
+  // (4) Finalize the run row. If THIS update fails it's a real DB problem
+  // — let it propagate so the cron exits 1 and we notice.
+  await db
+    .update(mailWorkerRuns)
+    .set({
+      finishedAt: sql`now()`,
+      status,
+      summary: summaryJson,
+      error: topLevelError ? topLevelError.message : null,
+    })
+    .where(eq(mailWorkerRuns.id, runId))
+
+  // (5) Notification orchestration. Catches its own LineNotifyError so we
+  // don't propagate transient LINE failures past the run boundary.
+  try {
+    await evaluateAndNotify(db, runId, log, opts.notifier)
+  } catch (err) {
+    log.warn('evaluateAndNotify threw', {
+      runId,
+      err: err instanceof Error ? err.message : String(err),
+    })
+  }
+
+  // If the pipeline itself top-level threw we should still rethrow so the
+  // CLI can exit non-zero. The run row is already persisted with
+  // status=imap_failed so the next run's evaluator can see it.
+  if (topLevelError) throw topLevelError
+
+  return { ...summary, runId }
+}
+
+function computeRunStatus(
+  summary: PipelineSummary,
+  imapError: boolean,
+): 'success' | 'imap_failed' | 'ai_failed' | 'partial' {
+  if (imapError) return 'imap_failed'
+  // AI partial: some succeeded, some failed.
+  if (summary.aiFailed > 0 && summary.aiSucceeded > 0) return 'partial'
+  // AI-only failure path: mails were fetched but AI failed on every attempt
+  // (i.e. zero successes). Skipped pre-filter mails are not counted as AI
+  // failures.
+  if (
+    summary.aiFailed > 0 &&
+    summary.aiSucceeded === 0 &&
+    (summary.aiFailed + summary.aiSucceeded) > 0
+  ) {
+    return 'ai_failed'
+  }
+  return 'success'
+}
+
+/**
+ * Look up subjects of drafts created during this run. We filter by
+ * `createdAt >= startedAt` and join through `mail_messages` for the subject
+ * line. Drafts are typically small in number per run (a handful at most), so
+ * the IN-list join is cheap.
+ *
+ * If the query fails for any reason we return `[]` rather than aborting the
+ * whole run — a missing notification preview is far less bad than rolling
+ * back a successful pipeline write.
+ */
+async function fetchNewDraftSubjects(
+  db: import('./db.js').Db,
+  startedAt: Date,
+): Promise<string[]> {
+  try {
+    const draftRows = await db
+      .select({ messageId: tournamentDrafts.messageId })
+      .from(tournamentDrafts)
+      .where(
+        and(
+          gte(tournamentDrafts.createdAt, startedAt),
+          eq(tournamentDrafts.status, 'pending_review'),
+        ),
+      )
+    if (draftRows.length === 0) return []
+    const ids = draftRows.map((r) => r.messageId)
+    const subjects = await db
+      .select({ subject: mailMessages.subject })
+      .from(mailMessages)
+      .where(inArray(mailMessages.id, ids))
+    return subjects
+      .map((r) => r.subject ?? '(no subject)')
+      .filter((s): s is string => typeof s === 'string')
+  } catch {
+    return []
+  }
+}
diff --git a/apps/mail-worker/systemd/kagetra-mail-worker.service b/apps/mail-worker/systemd/kagetra-mail-worker.service
new file mode 100644
index 0000000..cdfb38d
--- /dev/null
+++ b/apps/mail-worker/systemd/kagetra-mail-worker.service
@@ -0,0 +1,39 @@
+[Unit]
+Description=Kagetra mail-worker (cron + job dispatcher)
+After=network.target postgresql.service
+Documentation=https://github.com/poponta2020/kagetra_new/blob/main/docs/deploy/mail-worker.md
+
+[Service]
+# Type=oneshot — pipeline は冪等な 1 サイクル + exit 0/1 設計なので
+# 長期常駐させない。timer 側 (kagetra-mail-worker.timer) が 30 分ごとに
+# 起動する。多重起動は systemd が自動的に直列化する。
+Type=oneshot
+
+# 専用 system user (root 回避)。docs/deploy/mail-worker.md §1 で
+# `useradd -r -s /bin/bash -m -d /opt/kagetra kagetra` 手順を案内。
+User=kagetra
+Group=kagetra
+
+# kagetra deploy ルート。clone 後に corepack pnpm install + build した場所。
+WorkingDirectory=/opt/kagetra
+
+# DATABASE_URL, IMAP_HOST/USER/PASSWORD, ANTHROPIC_API_KEY 等を含む。
+# 実体は .env.production (mode 0600, owner kagetra)、リポジトリには
+# commit しない。LINE 認証情報は seed-system-channel.ts で DB に投入する
+# ので env には不要。
+EnvironmentFile=/opt/kagetra/.env.production
+
+# corepack 経由で pnpm を呼ぶことで Node 同梱版を使う (グローバル pnpm
+# 不要)。--filter で workspace を限定し、build 済みの dist/index.js を実行。
+ExecStart=/usr/bin/corepack pnpm --filter @kagetra/mail-worker exec node dist/index.js
+
+# journalctl -u kagetra-mail-worker.service で運用ログを追える。
+StandardOutput=journal
+StandardError=journal
+
+# 1 サイクル上限 5 分 (IMAP 取得 + AI 分類 + DB write の合計)。超えたら
+# kill して次回 timer 発火に任せる (途中まで処理した分は idempotent)。
+TimeoutStartSec=300
+
+# 安全ネット: 子プロセスが暴走したら 30 秒で SIGKILL。
+TimeoutStopSec=30
diff --git a/apps/mail-worker/systemd/kagetra-mail-worker.timer b/apps/mail-worker/systemd/kagetra-mail-worker.timer
new file mode 100644
index 0000000..436e239
--- /dev/null
+++ b/apps/mail-worker/systemd/kagetra-mail-worker.timer
@@ -0,0 +1,24 @@
+[Unit]
+Description=Run kagetra mail-worker every 30 minutes
+Documentation=https://github.com/poponta2020/kagetra_new/blob/main/docs/deploy/mail-worker.md
+Requires=kagetra-mail-worker.service
+
+[Timer]
+# 起動直後に走らせず、postgres / 他依存サービスの安定化を待つ。
+OnBootSec=2min
+
+# 前回 active になった時点から 30 分後に発火 (即時実行ではなく
+# interval ベース)。Type=oneshot との組み合わせで多重起動は無い。
+OnUnitActiveSec=30min
+
+# ±1 分の精度で OK (high-precision 不要、battery save 効果あり)。
+AccuracySec=1min
+
+# 起動時に missed run があれば catchup (例: ホストが reboot 中に
+# timer が空振りした場合、起動後に 1 回だけ走らせる)。
+Persistent=true
+
+Unit=kagetra-mail-worker.service
+
+[Install]
+WantedBy=timers.target
diff --git a/apps/mail-worker/test/jobs.test.ts b/apps/mail-worker/test/jobs.test.ts
new file mode 100644
index 0000000..a62bbd7
--- /dev/null
+++ b/apps/mail-worker/test/jobs.test.ts
@@ -0,0 +1,121 @@
+import { afterAll, beforeEach, describe, expect, it } from 'vitest'
+import { sql } from 'drizzle-orm'
+import { mailWorkerJobs, users } from '@kagetra/shared/schema'
+import { closeTestDb, testDb, truncateMailWorkerTables } from './test-db.js'
+import { closeDb, getDb } from '../src/db.js'
+import { claimNextJob, markJobDone, markJobFailed } from '../src/jobs.js'
+
+const ADMIN_USER_ID = 'user-admin-1'
+
+async function truncateUsers() {
+  // `users` references nothing the jobs queue cares about; CASCADE here
+  // pulls the FK from mail_worker_jobs / mail_worker_runs (`triggered_by`,
+  // `requested_by`) but those tables are already truncated by
+  // `truncateMailWorkerTables` first.
+  await testDb.execute(sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`)
+}
+
+async function seedAdmin() {
+  await testDb.insert(users).values({
+    id: ADMIN_USER_ID,
+    name: 'Admin',
+    email: 'admin@example.com',
+    role: 'admin',
+  })
+}
+
+async function seedJob(opts: { since?: Date | null } = {}): Promise<number> {
+  const inserted = await testDb
+    .insert(mailWorkerJobs)
+    .values({
+      requestedByUserId: ADMIN_USER_ID,
+      since: opts.since ?? null,
+      status: 'pending',
+    })
+    .returning({ id: mailWorkerJobs.id })
+  return inserted[0]!.id
+}
+
+describe('jobs queue', () => {
+  beforeEach(async () => {
+    await truncateMailWorkerTables()
+    await truncateUsers()
+    await seedAdmin()
+  })
+
+  afterAll(async () => {
+    await closeDb()
+    await closeTestDb()
+  })
+
+  it('claimNextJob picks the oldest pending job and flips status to claimed', async () => {
+    const since = new Date('2026-04-01T00:00:00+09:00')
+    const id = await seedJob({ since })
+
+    const claimed = await claimNextJob(getDb())
+    expect(claimed).not.toBeNull()
+    expect(claimed!.id).toBe(id)
+    expect(claimed!.requestedByUserId).toBe(ADMIN_USER_ID)
+    expect(claimed!.since?.toISOString()).toBe(since.toISOString())
+
+    // DB state: status=claimed, claimed_at populated.
+    const row = (await testDb.select().from(mailWorkerJobs))[0]!
+    expect(row.status).toBe('claimed')
+    expect(row.claimedAt).not.toBeNull()
+  })
+
+  it('returns null when no pending jobs are available', async () => {
+    const claimed = await claimNextJob(getDb())
+    expect(claimed).toBeNull()
+  })
+
+  it('two sequential claims return the two pending jobs in FIFO order', async () => {
+    // Distinct since values so we can verify the second claim returns the
+    // second row (not the first one re-claimed).
+    const sinceA = new Date('2026-04-01T00:00:00+09:00')
+    const sinceB = new Date('2026-04-02T00:00:00+09:00')
+    const idA = await seedJob({ since: sinceA })
+    const idB = await seedJob({ since: sinceB })
+
+    const first = await claimNextJob(getDb())
+    expect(first?.id).toBe(idA)
+    const second = await claimNextJob(getDb())
+    expect(second?.id).toBe(idB)
+    const third = await claimNextJob(getDb())
+    expect(third).toBeNull()
+  })
+
+  it('markJobDone sets status=done and links the run id', async () => {
+    const id = await seedJob()
+    await claimNextJob(getDb())
+
+    // We don't actually need a real run row here — `runId` is a plain int
+    // column with FK ON DELETE SET NULL, but the FK still requires the
+    // referenced row to exist. Insert a placeholder run for the FK.
+    const inserted = await testDb.execute<{ id: number }>(sql`
+      INSERT INTO mail_worker_runs (started_at, kind, status)
+      VALUES (now(), 'manual', 'success')
+      RETURNING id
+    `)
+    const runId = (inserted.rows[0] as { id: number }).id
+
+    await markJobDone(getDb(), id, runId)
+
+    const row = (await testDb.select().from(mailWorkerJobs))[0]!
+    expect(row.status).toBe('done')
+    expect(row.runId).toBe(runId)
+    expect(row.error).toBeNull()
+  })
+
+  it('markJobFailed records the error string and supports a null run id', async () => {
+    const id = await seedJob()
+    await claimNextJob(getDb())
+
+    await markJobFailed(getDb(), id, 'IMAP failed before run row was created', null)
+
+    const row = (await testDb.select().from(mailWorkerJobs))[0]!
+    expect(row.status).toBe('failed')
+    expect(row.error).toBe('IMAP failed before run row was created')
+    expect(row.runId).toBeNull()
+  })
+})
diff --git a/apps/mail-worker/test/notify/line.test.ts b/apps/mail-worker/test/notify/line.test.ts
new file mode 100644
index 0000000..a834e0e
--- /dev/null
+++ b/apps/mail-worker/test/notify/line.test.ts
@@ -0,0 +1,193 @@
+import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
+import { sql } from 'drizzle-orm'
+import { lineChannels } from '@kagetra/shared/schema'
+
+/**
+ * Hoisted mocks for `@line/bot-sdk` v11. The SDK exposes
+ * `messagingApi.MessagingApiClient` (verified against
+ * node_modules/@line/bot-sdk/dist/messaging-api/api/messagingApiClient.d.ts in
+ * this worktree) — we replace the class with a constructor-spy + pushMessage
+ * spy so we can assert on (a) the channelAccessToken pulled from the system
+ * channel row and (b) the `{ to, messages }` payload built by
+ * `pushSystemNotification`.
+ *
+ * `vi.hoisted` keeps the spies usable in both the mock factory (which vitest
+ * hoists above imports) and the test bodies. Without hoisting the closure
+ * would reference `undefined`.
+ */
+const { pushMessageSpy, constructorSpy, makeClientThrow } = vi.hoisted(() => {
+  const pushMessageSpy = vi.fn(async (_req: unknown) => ({}))
+  const constructorSpy = vi.fn()
+  let throwOnPush: unknown = null
+  return {
+    pushMessageSpy,
+    constructorSpy,
+    makeClientThrow: (err: unknown) => {
+      throwOnPush = err
+      pushMessageSpy.mockImplementationOnce(async () => {
+        throw throwOnPush
+      })
+    },
+  }
+})
+
+vi.mock('@line/bot-sdk', () => {
+  class FakeMessagingApiClient {
+    constructor(config: { channelAccessToken: string }) {
+      constructorSpy(config)
+    }
+    pushMessage = pushMessageSpy
+  }
+  return {
+    messagingApi: {
+      MessagingApiClient: FakeMessagingApiClient,
+    },
+  }
+})
+
+import {
+  LineNotifyError,
+  LineSystemChannelNotConfiguredError,
+  getSystemChannel,
+  pushSystemNotification,
+} from '../../src/notify/line.js'
+import { closeDb, getDb } from '../../src/db.js'
+import { closeTestDb, testDb } from '../test-db.js'
+
+const SYSTEM_CHANNEL_ID = 'C-system-1'
+const SYSTEM_TOKEN = 'system-token-xyz'
+const SYSTEM_BOT_ID = 'U-system-bot'
+const SYSTEM_ADMIN_USER = 'U-admin-1'
+
+async function truncateLineChannels() {
+  // Only `line_channels` is touched by these tests; mail_messages stays
+  // untouched so other test files can run in any order. CASCADE drops the
+  // `users.line_channel_id` reverse pointer too, but no users are seeded here.
+  await testDb.execute(sql`TRUNCATE TABLE line_channels RESTART IDENTITY CASCADE`)
+}
+
+interface SeedOpts {
+  status?: 'available' | 'assigned' | 'active' | 'system' | 'disabled'
+  channelId?: string
+  channelAccessToken?: string
+  botId?: string
+  notificationLineUserId?: string | null
+}
+
+async function seedChannel(opts: SeedOpts = {}) {
+  await testDb.insert(lineChannels).values({
+    channelId: opts.channelId ?? SYSTEM_CHANNEL_ID,
+    channelSecret: 'secret-xyz',
+    channelAccessToken: opts.channelAccessToken ?? SYSTEM_TOKEN,
+    botId: opts.botId ?? SYSTEM_BOT_ID,
+    status: opts.status ?? 'system',
+    notificationLineUserId:
+      opts.notificationLineUserId === undefined
+        ? SYSTEM_ADMIN_USER
+        : opts.notificationLineUserId,
+  })
+}
+
+describe('notify/line', () => {
+  beforeEach(async () => {
+    await truncateLineChannels()
+    pushMessageSpy.mockReset()
+    pushMessageSpy.mockResolvedValue({} as unknown as never)
+    constructorSpy.mockReset()
+    delete process.env.LINE_NOTIFY_DRY_RUN
+  })
+
+  afterEach(() => {
+    delete process.env.LINE_NOTIFY_DRY_RUN
+  })
+
+  afterAll(async () => {
+    await closeDb()
+    await closeTestDb()
+  })
+
+  describe('getSystemChannel', () => {
+    it("returns the row whose status='system'", async () => {
+      // Seed an unrelated `available` row first to confirm the WHERE filter
+      // actually narrows by status (rather than just LIMIT 1 on the table).
+      await seedChannel({
+        status: 'available',
+        channelId: 'C-pool-1',
+        channelAccessToken: 'pool-token',
+      })
+      await seedChannel({ status: 'system' })
+
+      const channel = await getSystemChannel(getDb())
+
+      expect(channel.channelAccessToken).toBe(SYSTEM_TOKEN)
+      expect(channel.botId).toBe(SYSTEM_BOT_ID)
+      expect(channel.notificationLineUserId).toBe(SYSTEM_ADMIN_USER)
+    })
+
+    it('throws LineSystemChannelNotConfiguredError when no system row exists', async () => {
+      // An `available` row exists but no `system` row → operator hasn't
+      // promoted any channel yet. Should hard-fail rather than silently use
+      // the pool token.
+      await seedChannel({ status: 'available' })
+
+      await expect(getSystemChannel(getDb())).rejects.toBeInstanceOf(
+        LineSystemChannelNotConfiguredError,
+      )
+    })
+  })
+
+  describe('pushSystemNotification', () => {
+    it('calls MessagingApiClient.pushMessage with the channel token + admin userId', async () => {
+      await seedChannel({ status: 'system' })
+
+      const result = await pushSystemNotification(getDb(), 'hello LINE')
+
+      expect(result.skipped).toBe(false)
+      expect(constructorSpy).toHaveBeenCalledWith({
+        channelAccessToken: SYSTEM_TOKEN,
+      })
+      expect(pushMessageSpy).toHaveBeenCalledTimes(1)
+      expect(pushMessageSpy).toHaveBeenCalledWith({
+        to: SYSTEM_ADMIN_USER,
+        messages: [{ type: 'text', text: 'hello LINE' }],
+      })
+    })
+
+    it("returns { skipped: true, reason: 'dry-run' } and DOES NOT call the SDK when LINE_NOTIFY_DRY_RUN=1", async () => {
+      await seedChannel({ status: 'system' })
+      process.env.LINE_NOTIFY_DRY_RUN = '1'
+
+      const result = await pushSystemNotification(getDb(), 'dry message')
+
+      expect(result).toEqual({ skipped: true, reason: 'dry-run' })
+      expect(constructorSpy).not.toHaveBeenCalled()
+      expect(pushMessageSpy).not.toHaveBeenCalled()
+    })
+
+    it("returns { skipped: true, reason: 'no-user-id' } when notificationLineUserId is null", async () => {
+      // System channel is seeded but the LINE Login webhook (P3-B) hasn't
+      // resolved an admin userId yet — we silently skip rather than hard-fail
+      // so the rest of the pipeline keeps running.
+      await seedChannel({ status: 'system', notificationLineUserId: null })
+
+      const result = await pushSystemNotification(getDb(), 'no-userid msg')
+
+      expect(result).toEqual({ skipped: true, reason: 'no-user-id' })
+      expect(pushMessageSpy).not.toHaveBeenCalled()
+    })
+
+    it('wraps SDK errors in LineNotifyError with the original error on .cause', async () => {
+      await seedChannel({ status: 'system' })
+      const sdkError = new Error('401 Unauthorized')
+      makeClientThrow(sdkError)
+
+      const caught = await pushSystemNotification(getDb(), 'will fail')
+        .then(() => null)
+        .catch((e: unknown) => e)
+
+      expect(caught).toBeInstanceOf(LineNotifyError)
+      expect((caught as LineNotifyError).cause).toBe(sdkError)
+      expect((caught as LineNotifyError).message).toMatch(/pushMessage failed/)
+    })
+  })
+})
diff --git a/apps/mail-worker/test/notify/message-templates.test.ts b/apps/mail-worker/test/notify/message-templates.test.ts
new file mode 100644
index 0000000..9698a26
--- /dev/null
+++ b/apps/mail-worker/test/notify/message-templates.test.ts
@@ -0,0 +1,147 @@
+import { describe, expect, it } from 'vitest'
+import {
+  buildErrorMessage,
+  buildNewDraftsMessage,
+} from '../../src/notify/message-templates.js'
+
+describe('buildNewDraftsMessage', () => {
+  it('throws on empty input (caller is expected to gate on N >= 1)', () => {
+    expect(() => buildNewDraftsMessage({ drafts: [] })).toThrow(
+      /requires at least one draft/,
+    )
+  })
+
+  it('renders a single draft without an overflow line', () => {
+    const out = buildNewDraftsMessage({
+      drafts: [{ subject: '第65回全日本選手権大会' }],
+    })
+    expect(out).toBe(
+      [
+        '📬 新規大会案内 1 件を取り込みました',
+        '・第65回全日本選手権大会',
+        '→ /admin/mail-inbox',
+      ].join('\n'),
+    )
+  })
+
+  it('renders exactly 5 drafts with all subjects, no overflow line', () => {
+    const drafts = [1, 2, 3, 4, 5].map((n) => ({ subject: `大会${n}` }))
+    const out = buildNewDraftsMessage({ drafts })
+    const lines = out.split('\n')
+    expect(lines).toEqual([
+      '📬 新規大会案内 5 件を取り込みました',
+      '・大会1',
+      '・大会2',
+      '・大会3',
+      '・大会4',
+      '・大会5',
+      '→ /admin/mail-inbox',
+    ])
+  })
+
+  it('truncates to top 5 and appends 他 N 件 when over limit (6 drafts → 1 件)', () => {
+    const drafts = [1, 2, 3, 4, 5, 6].map((n) => ({ subject: `大会${n}` }))
+    const out = buildNewDraftsMessage({ drafts })
+    const lines = out.split('\n')
+    expect(lines).toEqual([
+      '📬 新規大会案内 6 件を取り込みました',
+      '・大会1',
+      '・大会2',
+      '・大会3',
+      '・大会4',
+      '・大会5',
+      '他 1 件',
+      '→ /admin/mail-inbox',
+    ])
+  })
+
+  it('overflow line shows total - 5 (10 drafts → 他 5 件)', () => {
+    const drafts = Array.from({ length: 10 }, (_, i) => ({
+      subject: `大会${i + 1}`,
+    }))
+    const out = buildNewDraftsMessage({ drafts })
+    expect(out).toContain('📬 新規大会案内 10 件を取り込みました')
+    expect(out).toContain('他 5 件')
+    // Sanity: only the first 5 subjects show up explicitly
+    expect(out).toContain('・大会5')
+    expect(out).not.toContain('・大会6')
+    expect(out.endsWith('→ /admin/mail-inbox')).toBe(true)
+  })
+})
+
+describe('buildErrorMessage', () => {
+  it("kind='imap' uses the IMAP headline", () => {
+    const out = buildErrorMessage({
+      kind: 'imap',
+      recentRuns: 3,
+      lastError: 'IMAP socket closed',
+    })
+    expect(out).toContain('⚠️ メール取り込みが連続 3 回 IMAP エラーで失敗しています')
+    expect(out).toContain('IMAP socket closed')
+    expect(out.endsWith('→ /admin/mail-inbox')).toBe(true)
+  })
+
+  it("kind='ai' uses the AI headline", () => {
+    const out = buildErrorMessage({
+      kind: 'ai',
+      recentRuns: 4,
+      lastError: 'Anthropic 500',
+    })
+    expect(out).toContain('⚠️ AI 抽出が連続 4 件失敗しています')
+    expect(out).toContain('Anthropic 500')
+  })
+
+  it('lastError of exactly 199 chars is preserved verbatim (no ellipsis)', () => {
+    const detail = 'a'.repeat(199)
+    const out = buildErrorMessage({
+      kind: 'imap',
+      recentRuns: 3,
+      lastError: detail,
+    })
+    expect(out).toContain(detail)
+    expect(out).not.toContain('…')
+  })
+
+  it('lastError of exactly 200 chars is preserved verbatim (boundary)', () => {
+    const detail = 'a'.repeat(200)
+    const out = buildErrorMessage({
+      kind: 'imap',
+      recentRuns: 3,
+      lastError: detail,
+    })
+    expect(out).toContain(detail)
+    expect(out).not.toContain('…')
+  })
+
+  it('lastError of 201 chars is truncated to 200 + …', () => {
+    const detail = 'a'.repeat(201)
+    const out = buildErrorMessage({
+      kind: 'imap',
+      recentRuns: 3,
+      lastError: detail,
+    })
+    // The kept body is the first 200 chars; the appended ellipsis signals
+    // truncation. Original 201st char must NOT survive.
+    expect(out).toContain('a'.repeat(200) + '…')
+    expect(out).not.toContain('a'.repeat(201))
+  })
+
+  it('truncation counts Unicode code points, not UTF-16 units (surrogate-safe)', () => {
+    // 200 emoji (each is a surrogate pair, .length === 2 in UTF-16). Naive
+    // string.length truncation at 200 would mid-cut the 100th emoji.
+    const detail = '🍣'.repeat(201)
+    const out = buildErrorMessage({
+      kind: 'imap',
+      recentRuns: 3,
+      lastError: detail,
+    })
+    // Whole emoji are kept (200 of them) and nothing is cut in half.
+    expect(out).toContain('🍣'.repeat(200) + '…')
+    // No lone surrogate (would render as U+FFFD); using a code-point check
+    // via Array.from is the simplest assertion.
+    const detailLines = out.split('\n')
+    const emojiLine = detailLines.find((l) => l.startsWith('🍣')) ?? ''
+    // 200 code points + 1 ellipsis code point.
+    expect(Array.from(emojiLine).length).toBe(201)
+  })
+})
diff --git a/apps/mail-worker/test/pipeline-runs.test.ts b/apps/mail-worker/test/pipeline-runs.test.ts
new file mode 100644
index 0000000..ac6319e
--- /dev/null
+++ b/apps/mail-worker/test/pipeline-runs.test.ts
@@ -0,0 +1,476 @@
+import { readFile } from 'node:fs/promises'
+import { join } from 'node:path'
+import { fileURLToPath } from 'node:url'
+import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
+import { desc, eq } from 'drizzle-orm'
+import { mailWorkerRuns } from '@kagetra/shared/schema'
+import {
+  closeTestDb,
+  testDb,
+  truncateMailTables,
+  truncateMailWorkerTables,
+} from './test-db.js'
+import { runOnce } from '../src/pipeline.js'
+import { FixtureMailSource, type MailSource } from '../src/fetch/fetcher.js'
+import type { FetchSinceResult } from '../src/fetch/imap-client.js'
+import {
+  FixtureLLMExtractor,
+  loadFixturesFromDir,
+} from '../src/classify/llm/fixture.js'
+import { BrokenLLMExtractor } from '../src/classify/llm/broken.js'
+import type { LLMExtractor } from '../src/classify/llm/types.js'
+import { closeDb } from '../src/db.js'
+import type { MailWorkerRunSummary } from '../src/notify/orchestrator.js'
+
+const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url))
+const LLM_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/llm/', import.meta.url))
+
+async function loadEml(name: string): Promise<Buffer> {
+  return readFile(join(FIXTURE_DIR, name))
+}
+
+async function buildExtractor(): Promise<FixtureLLMExtractor> {
+  return new FixtureLLMExtractor(await loadFixturesFromDir(LLM_FIXTURE_DIR))
+}
+
+async function buildSource(emlNames: string[]): Promise<FixtureMailSource> {
+  const fixtures = await Promise.all(
+    emlNames.map(async (n) => ({ source: await loadEml(n) })),
+  )
+  return new FixtureMailSource(fixtures)
+}
+
+class ThrowingMailSource implements MailSource {
+  constructor(private readonly message: string) {}
+  async fetch(_since: Date | undefined): Promise<FetchSinceResult> {
+    throw new Error(this.message)
+  }
+  async close(): Promise<void> {
+    return undefined
+  }
+}
+
+/**
+ * Seed N synthetic prior runs into `mail_worker_runs` ordered by startedAt
+ * descending (newest first). Each run gets a distinct `started_at` so the
+ * `desc(startedAt)` ordering in `fetchRecentRuns` is deterministic.
+ *
+ * Returns the inserted ids in the same order as `seeds`.
+ */
+async function seedPriorRuns(
+  seeds: Array<{
+    summary: MailWorkerRunSummary
+    status: 'success' | 'imap_failed' | 'ai_failed' | 'partial'
+    startedAtOffsetMs: number // negative = older
+  }>,
+): Promise<number[]> {
+  const baseTime = Date.now()
+  const ids: number[] = []
+  for (const seed of seeds) {
+    const startedAt = new Date(baseTime + seed.startedAtOffsetMs)
+    const inserted = await testDb
+      .insert(mailWorkerRuns)
+      .values({
+        startedAt,
+        finishedAt: startedAt,
+        kind: 'cron',
+        status: seed.status,
+        summary: seed.summary,
+        error: null,
+      })
+      .returning({ id: mailWorkerRuns.id })
+    ids.push(inserted[0]!.id)
+  }
+  return ids
+}
+
+async function fetchRunById(id: number) {
+  const rows = await testDb
+    .select()
+    .from(mailWorkerRuns)
+    .where(eq(mailWorkerRuns.id, id))
+  return rows[0]!
+}
+
+async function latestRun() {
+  const rows = await testDb
+    .select()
+    .from(mailWorkerRuns)
+    .orderBy(desc(mailWorkerRuns.startedAt))
+    .limit(1)
+  return rows[0]!
+}
+
+describe('runOnce → mail_worker_runs persistence', () => {
+  beforeEach(async () => {
+    await truncateMailTables()
+    await truncateMailWorkerTables()
+  })
+
+  afterAll(async () => {
+    await closeDb()
+    await closeTestDb()
+  })
+
+  it('happy path: inserts running row and updates to success with summary counters', async () => {
+    const llm = await buildExtractor()
+    const source = await buildSource(['tournament-announcement.eml'])
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+
+    const result = await runOnce({
+      kind: 'cron',
+      source,
+      llmExtractor: llm,
+      notifier,
+    })
+
+    expect(result.runId).toBeGreaterThan(0)
+    expect(result.fetched).toBe(1)
+    expect(result.draftsInserted).toBe(1)
+
+    const row = await fetchRunById(result.runId)
+    expect(row.status).toBe('success')
+    expect(row.kind).toBe('cron')
+    expect(row.finishedAt).not.toBeNull()
+    expect(row.error).toBeNull()
+    expect(row.triggeredByUserId).toBeNull()
+
+    const summary = row.summary as MailWorkerRunSummary
+    expect(summary.fetched).toBe(1)
+    expect(summary.classified).toBe(1)
+    expect(summary.drafts_created).toBe(1)
+    expect(summary.ai_failed).toBe(0)
+    expect(summary.imap_error).toBe(false)
+    expect(summary.errors).toEqual([])
+    expect(summary.new_draft_subjects).toContain(
+      '[taikai-ajka:828] 第65回全日本選手権大会/ご案内',
+    )
+
+    // Notifier was called once for new drafts (no consecutive failure trigger).
+    expect(notifier).toHaveBeenCalledTimes(1)
+  })
+
+  it('IMAP throw → status=imap_failed and error/summary recorded; rethrows', async () => {
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+
+    await expect(
+      runOnce({
+        kind: 'cron',
+        source: new ThrowingMailSource('IMAP connect refused'),
+        notifier,
+      }),
+    ).rejects.toThrow(/IMAP connect refused/)
+
+    const row = await latestRun()
+    expect(row.status).toBe('imap_failed')
+    expect(row.error).toBe('IMAP connect refused')
+    const summary = row.summary as MailWorkerRunSummary
+    expect(summary.imap_error).toBe(true)
+    expect(summary.errors).toEqual(['IMAP connect refused'])
+    expect(summary.fetched).toBe(0)
+  })
+
+  it('AI partial: some succeed, some fail → status=partial', async () => {
+    // Two mails: one positive that uses the fixture extractor (succeeds),
+    // and one ml-tournament that the broken extractor throws on. We compose
+    // a custom extractor here.
+    const llmFixtures = await loadFixturesFromDir(LLM_FIXTURE_DIR)
+    const fixtureLlm = new FixtureLLMExtractor(llmFixtures)
+    const broken = new BrokenLLMExtractor()
+    const composite: LLMExtractor = {
+      modelId: 'composite-test',
+      async extract(input) {
+        if (input.emailMeta.subject.includes('第65回')) {
+          return fixtureLlm.extract(input)
+        }
+        return broken.extract(input)
+      },
+    }
+    const source = await buildSource([
+      'tournament-announcement.eml',
+      'ml-tournament-announcement.eml',
+    ])
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+
+    const result = await runOnce({
+      kind: 'cron',
+      source,
+      llmExtractor: composite,
+      notifier,
+    })
+
+    expect(result.aiSucceeded).toBe(1)
+    expect(result.aiFailed).toBe(1)
+    const row = await fetchRunById(result.runId)
+    expect(row.status).toBe('partial')
+    const summary = row.summary as MailWorkerRunSummary
+    expect(summary.ai_failed).toBe(1)
+    expect(summary.classified).toBe(2)
+  })
+
+  it('AI-only failure with no AI successes → status=ai_failed', async () => {
+    const source = await buildSource(['tournament-announcement.eml'])
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+
+    const result = await runOnce({
+      kind: 'cron',
+      source,
+      llmExtractor: new BrokenLLMExtractor(),
+      notifier,
+    })
+
+    expect(result.aiFailed).toBe(1)
+    expect(result.aiSucceeded).toBe(0)
+    const row = await fetchRunById(result.runId)
+    expect(row.status).toBe('ai_failed')
+  })
+
+  it('triggers IMAP consecutive-failure notification on the 3rd run and marks notified_imap_alert', async () => {
+    // Seed two prior IMAP-failed runs (NEITHER notified). Newest seed is at
+    // -1ms; the third-to-newest is at -1000ms — the current run will land at
+    // ~now() and become the most recent automatically.
+    await seedPriorRuns([
+      {
+        status: 'imap_failed',
+        summary: {
+          fetched: 0,
+          classified: 0,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: true,
+          errors: ['IMAP fail #1'],
+        },
+        startedAtOffsetMs: -2000,
+      },
+      {
+        status: 'imap_failed',
+        summary: {
+          fetched: 0,
+          classified: 0,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: true,
+          errors: ['IMAP fail #2'],
+        },
+        startedAtOffsetMs: -1000,
+      },
+    ])
+
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+
+    await expect(
+      runOnce({
+        kind: 'cron',
+        source: new ThrowingMailSource('IMAP fail #3'),
+        notifier,
+      }),
+    ).rejects.toThrow(/IMAP fail #3/)
+
+    expect(notifier).toHaveBeenCalledTimes(1)
+    const messageArg = notifier.mock.calls[0]![1] as string
+    expect(messageArg).toMatch(/連続/)
+    expect(messageArg).toMatch(/IMAP fail #3/)
+
+    const row = await latestRun()
+    const summary = row.summary as MailWorkerRunSummary
+    expect(summary.notified_imap_alert).toBe(true)
+  })
+
+  it('does NOT re-notify when the previous run already has notified_imap_alert=true', async () => {
+    await seedPriorRuns([
+      {
+        status: 'imap_failed',
+        summary: {
+          fetched: 0,
+          classified: 0,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: true,
+          errors: ['IMAP fail #1'],
+        },
+        startedAtOffsetMs: -3000,
+      },
+      {
+        status: 'imap_failed',
+        summary: {
+          fetched: 0,
+          classified: 0,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: true,
+          errors: ['IMAP fail #2'],
+        },
+        startedAtOffsetMs: -2000,
+      },
+      {
+        status: 'imap_failed',
+        summary: {
+          fetched: 0,
+          classified: 0,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: true,
+          errors: ['IMAP fail #3'],
+          notified_imap_alert: true,
+        },
+        startedAtOffsetMs: -1000,
+      },
+    ])
+
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+    await expect(
+      runOnce({
+        kind: 'cron',
+        source: new ThrowingMailSource('IMAP fail #4'),
+        notifier,
+      }),
+    ).rejects.toThrow(/IMAP fail #4/)
+
+    expect(notifier).not.toHaveBeenCalled()
+    const row = await latestRun()
+    const summary = row.summary as MailWorkerRunSummary
+    expect(summary.notified_imap_alert).toBeUndefined()
+  })
+
+  it('resets after recovery: success after notified, then 3 more failures re-notify', async () => {
+    // Seed: fail (notified) → success → fail × 2 → run a third failing run.
+    await seedPriorRuns([
+      {
+        status: 'imap_failed',
+        summary: {
+          fetched: 0,
+          classified: 0,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: true,
+          errors: ['old fail'],
+          notified_imap_alert: true,
+        },
+        startedAtOffsetMs: -5000,
+      },
+      {
+        status: 'success',
+        summary: {
+          fetched: 1,
+          classified: 1,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: false,
+          errors: [],
+        },
+        startedAtOffsetMs: -4000,
+      },
+      {
+        status: 'imap_failed',
+        summary: {
+          fetched: 0,
+          classified: 0,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: true,
+          errors: ['fail #1'],
+        },
+        startedAtOffsetMs: -2000,
+      },
+      {
+        status: 'imap_failed',
+        summary: {
+          fetched: 0,
+          classified: 0,
+          drafts_created: 0,
+          ai_failed: 0,
+          imap_error: true,
+          errors: ['fail #2'],
+        },
+        startedAtOffsetMs: -1000,
+      },
+    ])
+
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+    await expect(
+      runOnce({
+        kind: 'cron',
+        source: new ThrowingMailSource('fail #3'),
+        notifier,
+      }),
+    ).rejects.toThrow(/fail #3/)
+
+    expect(notifier).toHaveBeenCalledTimes(1)
+    const row = await latestRun()
+    const summary = row.summary as MailWorkerRunSummary
+    expect(summary.notified_imap_alert).toBe(true)
+  })
+
+  it('new-drafts notification fires when drafts_created > 0', async () => {
+    const llm = await buildExtractor()
+    const source = await buildSource(['tournament-announcement.eml'])
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+
+    await runOnce({
+      kind: 'cron',
+      source,
+      llmExtractor: llm,
+      notifier,
+    })
+    expect(notifier).toHaveBeenCalledTimes(1)
+    const message = notifier.mock.calls[0]![1] as string
+    expect(message).toMatch(/新規大会案内 1 件/)
+    expect(message).toMatch(/第65回/)
+  })
+
+  it('does NOT push when drafts_created is 0 (and no consecutive failure)', async () => {
+    const llm = await buildExtractor()
+    const source = await buildSource(['newsletter-with-unsubscribe.eml'])
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => ({}),
+    )
+
+    await runOnce({
+      kind: 'cron',
+      source,
+      llmExtractor: llm,
+      notifier,
+    })
+    expect(notifier).not.toHaveBeenCalled()
+  })
+
+  it('catches notifier throws (LineNotifyError-style) without aborting the run', async () => {
+    const llm = await buildExtractor()
+    const source = await buildSource(['tournament-announcement.eml'])
+    const notifier = vi.fn<(...args: unknown[]) => Promise<unknown>>(
+      async () => {
+        throw new Error('LINE 401 unauthorized')
+      },
+    )
+
+    const result = await runOnce({
+      kind: 'cron',
+      source,
+      llmExtractor: llm,
+      notifier,
+    })
+
+    // Run still finalised cleanly.
+    expect(result.runId).toBeGreaterThan(0)
+    const row = await fetchRunById(result.runId)
+    expect(row.status).toBe('success')
+    // Notifier was invoked (and threw); run row is intact.
+    expect(notifier).toHaveBeenCalledTimes(1)
+  })
+})
diff --git a/apps/mail-worker/test/test-db.ts b/apps/mail-worker/test/test-db.ts
index f8f3ca8..9a21ef3 100644
--- a/apps/mail-worker/test/test-db.ts
+++ b/apps/mail-worker/test/test-db.ts
@@ -30,6 +30,22 @@ export async function truncateMailTables() {
   await testDb.execute(sql`TRUNCATE TABLE mail_messages RESTART IDENTITY CASCADE`)
 }
 
+/**
+ * PR5 Phase 3: clear `mail_worker_runs` + `mail_worker_jobs` between tests
+ * that exercise the dispatcher / runOnce. Separate from `truncateMailTables`
+ * because some tests (e.g. classifier-only) don't need to touch the runs
+ * tables and a wider TRUNCATE would slow them down.
+ *
+ * `mail_worker_jobs` references `mail_worker_runs.id`, so we truncate the
+ * jobs table first (or rely on CASCADE). RESTART IDENTITY keeps assertions
+ * that compare against `runId === 1` deterministic across runs.
+ */
+export async function truncateMailWorkerTables() {
+  await testDb.execute(
+    sql`TRUNCATE TABLE mail_worker_jobs, mail_worker_runs RESTART IDENTITY CASCADE`,
+  )
+}
+
 export async function closeTestDb() {
   await testPool.end()
 }
diff --git a/apps/mail-worker/tsconfig.json b/apps/mail-worker/tsconfig.json
index 79cc749..60cb112 100644
--- a/apps/mail-worker/tsconfig.json
+++ b/apps/mail-worker/tsconfig.json
@@ -7,6 +7,6 @@
     "moduleResolution": "bundler",
     "types": ["node"]
   },
-  "include": ["src", "test"],
+  "include": ["src", "test", "scripts"],
   "exclude": ["node_modules", "dist"]
 }
diff --git a/apps/web/e2e/admin-mail-inbox-trigger.spec.ts b/apps/web/e2e/admin-mail-inbox-trigger.spec.ts
new file mode 100644
index 0000000..6884488
--- /dev/null
+++ b/apps/web/e2e/admin-mail-inbox-trigger.spec.ts
@@ -0,0 +1,125 @@
+import { expect, test } from '@playwright/test'
+import { eq } from 'drizzle-orm'
+import { mailWorkerJobs, mailWorkerRuns } from '@kagetra/shared/schema'
+import {
+  AUTHJS_SESSION_COOKIE,
+  seedAdminSession,
+} from '../src/test-utils/playwright-auth'
+import { testDb, truncateAll } from '../src/test-utils/db'
+
+/**
+ * /admin/mail-inbox manual fetch trigger E2E (PR5 Phase 4e).
+ *
+ * Covers the operator-facing path that lands a row in `mail_worker_jobs`:
+ *   1. Header "メール取り込み" button opens the dialog.
+ *   2. Default preset (7d) submits the Server Action.
+ *   3. UI surfaces "ジョブ #N を予約しました" + DB row exists with
+ *      status='pending' and requested_by_user_id=admin.id.
+ *
+ * The "最近の取り込み履歴" section's seeded row exercises the recent-runs
+ * table render — the actual claim/run cycle lives in the mail-worker tests
+ * (Phase 3) so this spec only asserts the page surfaces history, not that
+ * the job ever transitions out of 'pending'.
+ */
+
+async function addSessionCookie(
+  context: import('@playwright/test').BrowserContext,
+  token: string,
+) {
+  await context.addCookies([
+    {
+      name: AUTHJS_SESSION_COOKIE,
+      value: token,
+      domain: 'localhost',
+      path: '/',
+      httpOnly: true,
+      sameSite: 'Lax',
+    },
+  ])
+}
+
+test.describe.configure({ mode: 'serial' })
+
+test.describe('/admin/mail-inbox manual fetch trigger', () => {
+  test.beforeEach(async () => {
+    await truncateAll()
+  })
+
+  test('admin がメール取り込みボタンから 7d preset でジョブ予約できる', async ({
+    browser,
+  }) => {
+    const admin = await seedAdminSession({ name: 'Admin Trigger' })
+
+    // Seed one mail_worker_runs row so the recent-history section renders a
+    // real entry (not the empty-state card). Mirrors the success summary the
+    // pipeline writes when a cron run finishes cleanly.
+    await testDb.insert(mailWorkerRuns).values({
+      kind: 'cron',
+      status: 'success',
+      finishedAt: new Date(),
+      summary: { drafts_created: 2 },
+    })
+
+    const context = await browser.newContext()
+    await addSessionCookie(context, admin.sessionToken)
+    const page = await context.newPage()
+
+    await page.goto('/admin/mail-inbox')
+
+    // History section is visible with the seeded run.
+    await expect(page.getByText('最近の取り込み履歴')).toBeVisible()
+    await expect(page.getByText('定期')).toBeVisible()
+    await expect(page.getByText('成功')).toBeVisible()
+    await expect(page.getByText('2 件')).toBeVisible()
+
+    // Open the dialog from the header button.
+    await page.getByRole('button', { name: 'メール取り込み' }).click()
+    const dialog = page.getByRole('dialog', { name: 'メール取り込み' })
+    await expect(dialog).toBeVisible()
+
+    // Default selection is 7d (per pr5-plan.md Q5). Just confirm + submit.
+    await expect(page.getByLabel('過去 7 日')).toBeChecked()
+    await dialog.getByRole('button', { name: '実行' }).click()
+
+    // Inline success message lists the jobId from the Server Action envelope.
+    await expect(
+      page.getByText(/ジョブ #\d+ を予約しました/),
+    ).toBeVisible()
+
+    // DB should hold exactly one pending job for this admin.
+    const jobs = await testDb.select().from(mailWorkerJobs)
+    expect(jobs).toHaveLength(1)
+    expect(jobs[0]?.status).toBe('pending')
+    expect(jobs[0]?.requestedByUserId).toBe(admin.userId)
+
+    // since should be ~7 days before "now" — sanity-check the relation, not
+    // an exact timestamp that would race with wall clock drift.
+    const sinceMs = jobs[0]?.since?.getTime() ?? -1
+    const sevenDaysMs = 7 * 24 * 3600 * 1000
+    const now = Date.now()
+    expect(sinceMs).toBeGreaterThanOrEqual(now - sevenDaysMs - 60_000)
+    expect(sinceMs).toBeLessThanOrEqual(now - sevenDaysMs + 60_000)
+
+    await context.close()
+  })
+
+  test('履歴 0 件のとき空メッセージが表示される', async ({ browser }) => {
+    const admin = await seedAdminSession({ name: 'Admin History Empty' })
+
+    const context = await browser.newContext()
+    await addSessionCookie(context, admin.sessionToken)
+    const page = await context.newPage()
+
+    await page.goto('/admin/mail-inbox')
+    await expect(page.getByText('まだ実行履歴がありません')).toBeVisible()
+
+    // Verify lookup still works after revalidate by ensuring no rows leak in.
+    const runs = await testDb
+      .select()
+      .from(mailWorkerRuns)
+      .where(eq(mailWorkerRuns.kind, 'cron'))
+    expect(runs).toHaveLength(0)
+
+    await context.close()
+  })
+})
diff --git a/apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts b/apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts
index 3589ee7..758a2cc 100644
--- a/apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts
+++ b/apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts
@@ -3,6 +3,7 @@ import { eq } from 'drizzle-orm'
 import {
   eventGroups,
   events,
+  mailWorkerJobs,
   tournamentDrafts,
 } from '@kagetra/shared/schema'
 import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
@@ -44,8 +45,13 @@ vi.mock('@kagetra/mail-worker/config', () => ({
 
 // Import after mocks so `@/auth` and the mail-worker imports resolve to the
 // mocked modules.
-const { approveDraft, rejectDraft, linkDraftToEvent, reextractDraft } =
-  await import('./actions')
+const {
+  approveDraft,
+  rejectDraft,
+  linkDraftToEvent,
+  reextractDraft,
+  triggerMailFetch,
+} = await import('./actions')
 
 function buildApproveFormData(overrides: Partial<Record<string, string>> = {}) {
   const fd = new FormData()
@@ -539,4 +545,199 @@ describe('admin/mail-inbox actions', () => {
       expect(classifyMailMock).toHaveBeenCalledTimes(1)
     })
   })
+
+  describe('triggerMailFetch', () => {
+    function buildFormData(
+      preset: '24h' | '3d' | '7d' | 'custom',
+      customDate?: string,
+    ) {
+      const fd = new FormData()
+      fd.set('preset', preset)
+      if (customDate !== undefined) fd.set('customDate', customDate)
+      return fd
+    }
+
+    it('admin が 7d preset で job を予約できる', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+
+      const before = Date.now()
+      const result = await triggerMailFetch(buildFormData('7d'))
+
+      expect(result.ok).toBe(true)
+      if (!result.ok) throw new Error('expected ok')
+      expect(typeof result.jobId).toBe('number')
+
+      const job = await testDb.query.mailWorkerJobs.findFirst({
+        where: eq(mailWorkerJobs.id, result.jobId),
+      })
+      expect(job?.status).toBe('pending')
+      expect(job?.requestedByUserId).toBe(admin.id)
+      // since should land roughly 7 days before "now" (within a few seconds
+      // of the call). Use a generous window so a slow CI host doesn't flake.
+      const sevenDaysMs = 7 * 24 * 3600 * 1000
+      const sinceMs = job?.since?.getTime() ?? -1
+      expect(sinceMs).toBeGreaterThanOrEqual(before - sevenDaysMs - 5000)
+      expect(sinceMs).toBeLessThanOrEqual(before - sevenDaysMs + 5000)
+    })
+
+    it('vice_admin も予約できる', async () => {
+      const vice = await createUser({ role: 'vice_admin' })
+      await setAuthSession({ id: vice.id, role: 'vice_admin' })
+
+      const result = await triggerMailFetch(buildFormData('7d'))
+      expect(result.ok).toBe(true)
+      if (!result.ok) throw new Error('expected ok')
+
+      const job = await testDb.query.mailWorkerJobs.findFirst({
+        where: eq(mailWorkerJobs.id, result.jobId),
+      })
+      expect(job?.requestedByUserId).toBe(vice.id)
+    })
+
+    it('未認証は Unauthorized を投げる (job は作られない)', async () => {
+      await setAuthSession(null)
+
+      await expect(triggerMailFetch(buildFormData('7d'))).rejects.toThrow(
+        'Unauthorized',
+      )
+      const jobs = await testDb.select().from(mailWorkerJobs)
+      expect(jobs).toHaveLength(0)
+    })
+
+    it('member ロールは Forbidden を投げる (job は作られない)', async () => {
+      const member = await createUser()
+      await setAuthSession({ id: member.id, role: 'member' })
+
+      await expect(triggerMailFetch(buildFormData('7d'))).rejects.toThrow(
+        'Forbidden',
+      )
+      const jobs = await testDb.select().from(mailWorkerJobs)
+      expect(jobs).toHaveLength(0)
+    })
+
+    it('preset=24h で since が ~24h 前', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+      const before = Date.now()
+
+      const result = await triggerMailFetch(buildFormData('24h'))
+      if (!result.ok) throw new Error('expected ok')
+      const job = await testDb.query.mailWorkerJobs.findFirst({
+        where: eq(mailWorkerJobs.id, result.jobId),
+      })
+      const expected = before - 24 * 3600 * 1000
+      const sinceMs = job?.since?.getTime() ?? -1
+      expect(sinceMs).toBeGreaterThanOrEqual(expected - 5000)
+      expect(sinceMs).toBeLessThanOrEqual(expected + 5000)
+    })
+
+    it('preset=3d で since が ~3 days 前', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+      const before = Date.now()
+
+      const result = await triggerMailFetch(buildFormData('3d'))
+      if (!result.ok) throw new Error('expected ok')
+      const job = await testDb.query.mailWorkerJobs.findFirst({
+        where: eq(mailWorkerJobs.id, result.jobId),
+      })
+      const expected = before - 3 * 24 * 3600 * 1000
+      const sinceMs = job?.since?.getTime() ?? -1
+      expect(sinceMs).toBeGreaterThanOrEqual(expected - 5000)
+      expect(sinceMs).toBeLessThanOrEqual(expected + 5000)
+    })
+
+    it('preset=custom + customDate=2026-04-20 で since が JST 0:00', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+
+      const result = await triggerMailFetch(
+        buildFormData('custom', '2026-04-20'),
+      )
+      if (!result.ok) throw new Error('expected ok')
+
+      const job = await testDb.query.mailWorkerJobs.findFirst({
+        where: eq(mailWorkerJobs.id, result.jobId),
+      })
+      // 2026-04-20T00:00:00+09:00 === 2026-04-19T15:00:00Z
+      expect(job?.since?.toISOString()).toBe('2026-04-19T15:00:00.000Z')
+    })
+
+    it('preset=custom で customDate 欠如だと invalid form input', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+
+      const result = await triggerMailFetch(buildFormData('custom'))
+      expect(result.ok).toBe(false)
+      if (result.ok) throw new Error('expected error')
+      expect(result.error).toBe('invalid form input')
+
+      const jobs = await testDb.select().from(mailWorkerJobs)
+      expect(jobs).toHaveLength(0)
+    })
+
+    it('preset=custom で customDate が regex 違反だと invalid form input', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+
+      const result = await triggerMailFetch(
+        buildFormData('custom', '2026/04/20'),
+      )
+      expect(result.ok).toBe(false)
+      if (result.ok) throw new Error('expected error')
+      expect(result.error).toBe('invalid form input')
+
+      const jobs = await testDb.select().from(mailWorkerJobs)
+      expect(jobs).toHaveLength(0)
+    })
+
+    it('未知の preset は invalid form input', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+
+      const fd = new FormData()
+      fd.set('preset', 'bogus')
+      const result = await triggerMailFetch(fd)
+      expect(result.ok).toBe(false)
+      if (result.ok) throw new Error('expected error')
+      expect(result.error).toBe('invalid form input')
+    })
+
+    it('未来日付の customDate は弾く', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+
+      // Pick a date safely in the future so the test stays valid as the
+      // current date marches forward.
+      const future = new Date(Date.now() + 365 * 24 * 3600 * 1000)
+      const yyyy = future.getUTCFullYear()
+      const mm = String(future.getUTCMonth() + 1).padStart(2, '0')
+      const dd = String(future.getUTCDate()).padStart(2, '0')
+      const result = await triggerMailFetch(
+        buildFormData('custom', `${yyyy}-${mm}-${dd}`),
+      )
+      expect(result.ok).toBe(false)
+      if (result.ok) throw new Error('expected error')
+      expect(result.error).toMatch(/未来/)
+
+      const jobs = await testDb.select().from(mailWorkerJobs)
+      expect(jobs).toHaveLength(0)
+    })
+
+    it('mail_worker_jobs に INSERT され status=pending、戻り値 { ok: true, jobId }', async () => {
+      const admin = await createAdmin()
+      await setAuthSession({ id: admin.id, role: 'admin' })
+
+      const result = await triggerMailFetch(buildFormData('24h'))
+      expect(result.ok).toBe(true)
+      if (!result.ok) throw new Error('expected ok')
+      expect(result.jobId).toBeGreaterThan(0)
+
+      const jobs = await testDb.select().from(mailWorkerJobs)
+      expect(jobs).toHaveLength(1)
+      expect(jobs[0]?.id).toBe(result.jobId)
+      expect(jobs[0]?.status).toBe('pending')
+    })
+  })
 })
diff --git a/apps/web/src/app/(app)/admin/mail-inbox/actions.ts b/apps/web/src/app/(app)/admin/mail-inbox/actions.ts
index 7d0822c..8cfc559 100644
--- a/apps/web/src/app/(app)/admin/mail-inbox/actions.ts
+++ b/apps/web/src/app/(app)/admin/mail-inbox/actions.ts
@@ -2,9 +2,15 @@
 
 import { and, eq, inArray, sql } from 'drizzle-orm'
 import { revalidatePath } from 'next/cache'
+import { z } from 'zod'
 import { auth } from '@/auth'
 import { db } from '@/lib/db'
-import { eventGroups, events, tournamentDrafts } from '@kagetra/shared/schema'
+import {
+  eventGroups,
+  events,
+  mailWorkerJobs,
+  tournamentDrafts,
+} from '@kagetra/shared/schema'
 import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
 import {
   classifyMail,
@@ -196,3 +202,113 @@ export async function linkDraftToEvent(draftId: number, eventId: number) {
   revalidatePath(`/admin/mail-inbox/${draftId}`)
   revalidatePath(`/events/${eventId}`)
 }
+
+// PR5 Phase 4a — manual mail-fetch job queue.
+//
+// The Server Action is INSERT-only into `mail_worker_jobs`; the systemd-timer
+// driven mail-worker dispatcher claims the row via FOR UPDATE SKIP LOCKED on
+// its next tick (~30 min). UI feedback is therefore "ジョブ #N を予約しました"
+// only — no progress polling in v1 (deferred per pr5-plan.md).
+const PRESET_VALUES = ['24h', '3d', '7d', 'custom'] as const
+const triggerMailFetchSchema = z
+  .object({
+    preset: z.enum(PRESET_VALUES),
+    // YYYY-MM-DD only when preset='custom'. The regex enforces the shape so
+    // computeSince()'s `${customDate}T00:00:00+09:00` template can never
+    // produce an Invalid Date silently.
+    customDate: z
+      .string()
+      .regex(/^\d{4}-\d{2}-\d{2}$/, 'customDate は YYYY-MM-DD 形式')
+      .optional(),
+  })
+  .refine(
+    (v) => v.preset !== 'custom' || !!v.customDate,
+    { message: 'preset=custom のとき customDate が必須', path: ['customDate'] },
+  )
+
+/**
+ * Compute the `since` timestamp from the form preset.
+ *
+ *   '24h'    → now - 24 hours
+ *   '3d'     → now - 3 days
+ *   '7d'     → now - 7 days
+ *   'custom' → JST 0:00 of the given YYYY-MM-DD
+ *
+ * JST round-trip mirrors `apps/mail-worker/src/cli-args.ts`'s `parseSinceArg`
+ * — bare `new Date('2026-04-12')` would resolve to UTC midnight (= 09:00 JST)
+ * and silently drop mails received between 00:00 and 08:59 JST that day.
+ * Mail-worker's exports map does not surface `cli-args`, so we keep the
+ * computation duplicated here rather than widening the package surface.
+ */
+function computeSince(input: { preset: (typeof PRESET_VALUES)[number]; customDate?: string }): Date {
+  const now = Date.now()
+  switch (input.preset) {
+    case '24h':
+      return new Date(now - 24 * 3600 * 1000)
+    case '3d':
+      return new Date(now - 3 * 24 * 3600 * 1000)
+    case '7d':
+      return new Date(now - 7 * 24 * 3600 * 1000)
+    case 'custom': {
+      // refine() above guarantees customDate is set when preset='custom',
+      // but TypeScript narrowing through the discriminated union on a single
+      // optional field needs the explicit guard.
+      if (!input.customDate) {
+        throw new Error('customDate required for preset=custom')
+      }
+      const d = new Date(`${input.customDate}T00:00:00+09:00`)
+      if (Number.isNaN(d.getTime())) {
+        throw new Error(`invalid customDate: ${input.customDate}`)
+      }
+      return d
+    }
+  }
+}
+
+export async function triggerMailFetch(
+  formData: FormData,
+): Promise<{ ok: true; jobId: number } | { ok: false; error: string }> {
+  // Authorization throws (Unauthorized / Forbidden) so unauthenticated /
+  // member callers never reach the validate path; callers can rely on the
+  // throw for the authn/authz gate just like the other actions in this file.
+  const session = await requireAdminSession()
+
+  const raw = {
+    preset: formData.get('preset'),
+    // FormData.get returns FormDataEntryValue | null; z.string() rejects
+    // anything but string so a missing field surfaces as invalid form input.
+    customDate: formData.get('customDate') ?? undefined,
+  }
+  const parsed = triggerMailFetchSchema.safeParse(raw)
+  if (!parsed.success) {
+    return { ok: false, error: 'invalid form input' }
+  }
+
+  let since: Date
+  try {
+    since = computeSince(parsed.data)
+  } catch {
+    return { ok: false, error: 'invalid form input' }
+  }
+
+  // Future-dated `since` makes no semantic sense (the IMAP fetch would return
+  // zero rows and waste a worker cycle). Cheaper to refuse here than to let
+  // the dispatcher discover it.
+  if (since.getTime() > Date.now()) {
+    return { ok: false, error: 'since が未来日付です' }
+  }
+
+  const inserted = await db
+    .insert(mailWorkerJobs)
+    .values({
+      requestedByUserId: session.user.id,
+      since,
+      status: 'pending',
+    })
+    .returning({ id: mailWorkerJobs.id })
+  const job = inserted[0]
+  if (!job) throw new Error('mail_worker_jobs insert failed')
+
+  revalidatePath('/admin/mail-inbox')
+  return { ok: true, jobId: job.id }
+}
diff --git a/apps/web/src/app/(app)/admin/mail-inbox/components/TriggerFetchButton.tsx b/apps/web/src/app/(app)/admin/mail-inbox/components/TriggerFetchButton.tsx
new file mode 100644
index 0000000..811d39b
--- /dev/null
+++ b/apps/web/src/app/(app)/admin/mail-inbox/components/TriggerFetchButton.tsx
@@ -0,0 +1,192 @@
+'use client'
+
+import { useEffect, useRef, useState, useTransition } from 'react'
+import { useRouter } from 'next/navigation'
+import { Btn } from '@/components/ui'
+import { triggerMailFetch } from '../actions'
+
+type Preset = '24h' | '3d' | '7d' | 'custom'
+
+interface PresetOption {
+  value: Preset
+  label: string
+}
+
+// Order mirrors pr5-plan.md Q5: 24h / 3d / 7d (default) / custom.
+const PRESETS: PresetOption[] = [
+  { value: '24h', label: '過去 24 時間' },
+  { value: '3d', label: '過去 3 日' },
+  { value: '7d', label: '過去 7 日' },
+  { value: 'custom', label: '任意日付' },
+]
+
+/**
+ * Header-right action on /admin/mail-inbox. Opens a small modal where an
+ * admin picks a `since` preset and posts a job into `mail_worker_jobs`. The
+ * mail-worker dispatcher (systemd timer, ~30 min cadence) claims the row
+ * and runs the IMAP fetch on its next tick — so success feedback is
+ * "ジョブ #N を予約しました" only. No progress polling in v1.
+ *
+ * Rendered as a Client Component because the dialog state, the form state,
+ * and `useTransition` all need to live on the client. The Server Action
+ * lives in `../actions.ts` and is imported as a function; the form posts
+ * via JS rather than HTML form action so we can read the
+ * `{ ok, jobId | error }` envelope and surface the result inline.
+ */
+export function TriggerFetchButton() {
+  const [open, setOpen] = useState(false)
+  const [preset, setPreset] = useState<Preset>('7d')
+  const [customDate, setCustomDate] = useState('')
+  const [feedback, setFeedback] = useState<
+    | { kind: 'idle' }
+    | { kind: 'success'; jobId: number }
+    | { kind: 'error'; message: string }
+  >({ kind: 'idle' })
+  const [isPending, startTransition] = useTransition()
+  const router = useRouter()
+  const dialogRef = useRef<HTMLDialogElement>(null)
+
+  // Drive the native <dialog> element from the `open` state so consumers (and
+  // Playwright's getByRole('dialog')) see the standard show/hide semantics.
+  // showModal() also handles Esc-to-close + the backdrop blocker for free.
+  useEffect(() => {
+    const dlg = dialogRef.current
+    if (!dlg) return
+    if (open && !dlg.open) {
+      dlg.showModal()
+    } else if (!open && dlg.open) {
+      dlg.close()
+    }
+  }, [open])
+
+  const reset = () => {
+    setPreset('7d')
+    setCustomDate('')
+    setFeedback({ kind: 'idle' })
+  }
+
+  const handleClose = () => {
+    setOpen(false)
+    reset()
+  }
+
+  const onSubmit = () => {
+    setFeedback({ kind: 'idle' })
+    startTransition(async () => {
+      const fd = new FormData()
+      fd.set('preset', preset)
+      if (preset === 'custom') fd.set('customDate', customDate)
+      try {
+        const result = await triggerMailFetch(fd)
+        if (result.ok) {
+          setFeedback({ kind: 'success', jobId: result.jobId })
+          // Refresh so the run history table picks up any state change the
+          // worker may have written between submit and the redirect.
+          router.refresh()
+        } else {
+          setFeedback({ kind: 'error', message: result.error })
+        }
+      } catch (e) {
+        // Authorization failures throw from requireAdminSession(); surface
+        // the message instead of crashing the client component.
+        const msg = e instanceof Error ? e.message : 'unknown error'
+        setFeedback({ kind: 'error', message: msg })
+      }
+    })
+  }
+
+  const submitDisabled =
+    isPending || (preset === 'custom' && !customDate)
+
+  return (
+    <>
+      <Btn kind="secondary" size="sm" onClick={() => setOpen(true)}>
+        メール取り込み
+      </Btn>
+      <dialog
+        ref={dialogRef}
+        className="rounded-lg border border-border bg-surface p-0 backdrop:bg-black/40"
+        onClose={handleClose}
+        aria-label="メール取り込み"
+      >
+        <div className="flex w-[min(92vw,420px)] flex-col gap-4 p-5">
+          <div className="flex items-center justify-between">
+            <h2 className="font-display text-lg font-bold text-ink">
+              メール取り込み
+            </h2>
+            <button
+              type="button"
+              className="text-ink-meta hover:text-ink"
+              onClick={handleClose}
+              aria-label="閉じる"
+            >
+              ×
+            </button>
+          </div>
+
+          <fieldset className="flex flex-col gap-2">
+            <legend className="text-sm font-medium text-ink-2">
+              取り込み期間
+            </legend>
+            {PRESETS.map((opt) => (
+              <label
+                key={opt.value}
+                htmlFor={`mail-fetch-preset-${opt.value}`}
+                className="flex items-center gap-2 text-sm text-ink"
+              >
+                <input
+                  id={`mail-fetch-preset-${opt.value}`}
+                  type="radio"
+                  name="mail-fetch-preset"
+                  value={opt.value}
+                  checked={preset === opt.value}
+                  onChange={() => setPreset(opt.value)}
+                />
+                <span>{opt.label}</span>
+              </label>
+            ))}
+          </fieldset>
+
+          {preset === 'custom' && (
+            <label className="flex flex-col gap-1 text-sm text-ink-2">
+              <span>取り込み開始日 (JST 0:00 起点)</span>
+              <input
+                type="date"
+                value={customDate}
+                onChange={(e) => setCustomDate(e.target.value)}
+                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
+              />
+            </label>
+          )}
+
+          {feedback.kind === 'success' && (
+            <p className="text-sm text-success-fg">
+              ジョブ #{feedback.jobId} を予約しました。次回 cron 実行 (~30
+              分以内) で処理されます
+            </p>
+          )}
+          {feedback.kind === 'error' && (
+            <p className="text-sm text-danger-fg">
+              ジョブ予約失敗: {feedback.message}
+            </p>
+          )}
+
+          <div className="flex justify-end gap-2">
+            <Btn kind="ghost" size="md" onClick={handleClose} type="button">
+              キャンセル
+            </Btn>
+            <Btn
+              kind="primary"
+              size="md"
+              onClick={onSubmit}
+              disabled={submitDisabled}
+              type="button"
+            >
+              {isPending ? '予約中...' : '実行'}
+            </Btn>
+          </div>
+        </div>
+      </dialog>
+    </>
+  )
+}
diff --git a/apps/web/src/app/(app)/admin/mail-inbox/page.tsx b/apps/web/src/app/(app)/admin/mail-inbox/page.tsx
index 8281938..7f33efb 100644
--- a/apps/web/src/app/(app)/admin/mail-inbox/page.tsx
+++ b/apps/web/src/app/(app)/admin/mail-inbox/page.tsx
@@ -1,9 +1,12 @@
 import { auth } from '@/auth'
 import { redirect } from 'next/navigation'
+import { desc } from 'drizzle-orm'
 import { db } from '@/lib/db'
 import { Card, Pill, type PillTone } from '@/components/ui'
+import { mailWorkerRuns } from '@kagetra/shared/schema'
 import { AttachmentList } from './components/AttachmentList'
 import { DraftCard } from './components/DraftCard'
+import { TriggerFetchButton } from './components/TriggerFetchButton'
 
 /**
  * /admin/mail-inbox — list of mails fetched by `apps/mail-worker` (PR1).
@@ -37,6 +40,21 @@ const CLASSIFICATION_LABEL: Record<string, { label: string; tone: PillTone }> =
   unknown: { label: '不明', tone: 'neutral' },
 }
 
+// PR5 Phase 4c — `mail_worker_runs.status` mapping for the recent-runs table.
+// Mirrors the enum in packages/shared/src/schema/enums.ts.
+const RUN_STATUS_LABEL: Record<string, { label: string; tone: PillTone }> = {
+  running: { label: '実行中', tone: 'info' },
+  success: { label: '成功', tone: 'success' },
+  imap_failed: { label: 'IMAP 失敗', tone: 'danger' },
+  ai_failed: { label: 'AI 失敗', tone: 'danger' },
+  partial: { label: '部分成功', tone: 'warn' },
+}
+
+const RUN_KIND_LABEL: Record<string, string> = {
+  cron: '定期',
+  manual: '手動',
+}
+
 function formatJst(date: Date): string {
   return date.toLocaleString('ja-JP', {
     timeZone: 'Asia/Tokyo',
@@ -57,6 +75,24 @@ export default async function MailInboxPage() {
     redirect('/403')
   }
 
+  // PR5 Phase 4c — recent mail-worker invocations. The list query below is the
+  // existing PR1-PR4 surface; this query is independent so it can fail or
+  // return empty without affecting the inbox itself. Limit 5 mirrors the
+  // pr5-plan.md DoD ("直近 5 件").
+  const recentRuns = await db
+    .select({
+      id: mailWorkerRuns.id,
+      startedAt: mailWorkerRuns.startedAt,
+      finishedAt: mailWorkerRuns.finishedAt,
+      kind: mailWorkerRuns.kind,
+      status: mailWorkerRuns.status,
+      summary: mailWorkerRuns.summary,
+      error: mailWorkerRuns.error,
+    })
+    .from(mailWorkerRuns)
+    .orderBy(desc(mailWorkerRuns.startedAt))
+    .limit(5)
+
   // List view never renders body_text / body_html. Restrict columns so the top
   // 100 rows don't drag full HTML bodies across the wire on every page load.
   // PR2 layers in attachment chips: we pull only the chip-worthy columns
@@ -104,8 +140,76 @@ export default async function MailInboxPage() {
     <div className="flex flex-col gap-4">
       <div className="flex items-center justify-between">
         <h1 className="font-display text-xl font-bold text-ink">メール受信箱</h1>
+        <TriggerFetchButton />
       </div>
 
+      <section className="flex flex-col gap-2">
+        <h2 className="font-display text-sm font-semibold text-ink-2">
+          最近の取り込み履歴
+        </h2>
+        {recentRuns.length === 0 ? (
+          <Card>
+            <div className="py-3 text-center text-xs text-ink-meta">
+              まだ実行履歴がありません
+            </div>
+          </Card>
+        ) : (
+          <Card>
+            <div className="overflow-x-auto">
+              <table className="w-full text-xs">
+                <thead>
+                  <tr className="border-b border-border-soft text-left text-ink-meta">
+                    <th className="py-1 pr-3 font-medium">開始</th>
+                    <th className="py-1 pr-3 font-medium">種別</th>
+                    <th className="py-1 pr-3 font-medium">状態</th>
+                    <th className="py-1 pr-3 font-medium">新規 draft</th>
+                  </tr>
+                </thead>
+                <tbody>
+                  {recentRuns.map((run) => {
+                    const status = RUN_STATUS_LABEL[run.status] ?? {
+                      label: run.status,
+                      tone: 'neutral' as const,
+                    }
+                    const kindLabel = RUN_KIND_LABEL[run.kind] ?? run.kind
+                    // summary jsonb is `unknown`. Pull the one field we render
+                    // defensively without trusting the shape.
+                    const summary = (run.summary ?? {}) as {
+                      drafts_created?: number
+                    }
+                    const draftsCreated = summary.drafts_created ?? 0
+                    return (
+                      <tr
+                        key={run.id}
+                        className="border-b border-border-soft last:border-0"
+                      >
+                        <td className="py-1.5 pr-3 text-ink-2">
+                          {formatJst(run.startedAt)}
+                        </td>
+                        <td className="py-1.5 pr-3 text-ink-2">{kindLabel}</td>
+                        <td className="py-1.5 pr-3">
+                          <span
+                            className="inline-flex items-center gap-1"
+                            title={run.error ?? undefined}
+                          >
+                            <Pill tone={status.tone} size="sm">
+                              {status.label}
+                            </Pill>
+                          </span>
+                        </td>
+                        <td className="py-1.5 pr-3 text-ink-2">
+                          {draftsCreated} 件
+                        </td>
+                      </tr>
+                    )
+                  })}
+                </tbody>
+              </table>
+            </div>
+          </Card>
+        )}
+      </section>
+
       {rows.length === 0 ? (
         <Card>
           <div className="py-6 text-center text-ink-meta">
diff --git a/apps/web/src/test-utils/db.ts b/apps/web/src/test-utils/db.ts
index 5d7c280..98e46ac 100644
--- a/apps/web/src/test-utils/db.ts
+++ b/apps/web/src/test-utils/db.ts
@@ -12,12 +12,21 @@ export const testDb = drizzle(testPool, { schema })
 
 // TRUNCATE all tables (CASCADE to handle FK). Call in beforeEach.
 // Table names match pgTable(...) first arg in packages/shared/src/schema/*.ts.
+//
+// PR5 added `mail_worker_jobs` (requested_by_user_id ON DELETE CASCADE — would
+// disappear with users anyway) and `mail_worker_runs` (triggered_by_user_id
+// ON DELETE SET NULL — would survive as orphaned rows). Listing both
+// explicitly + RESTART IDENTITY keeps inserted ids deterministic across tests
+// and isolates the trigger/run history between specs.
 export async function truncateAll() {
   await testDb.execute(sql`
     TRUNCATE TABLE
       tournament_drafts,
       mail_attachments,
       mail_messages,
+      mail_worker_jobs,
+      mail_worker_runs,
+      line_channels,
       event_attendances,
       schedule_items,
       events,
diff --git a/docs/deploy/mail-worker.md b/docs/deploy/mail-worker.md
new file mode 100644
index 0000000..d55e674
--- /dev/null
+++ b/docs/deploy/mail-worker.md
@@ -0,0 +1,173 @@
+# mail-worker デプロイ手順 (Lightsail / systemd)
+
+Phase P3-A メール大会取り込みの本番運用手順。`apps/mail-worker` を AWS
+Lightsail 上に systemd timer で 30 分ごとに動かすまでの一通り。
+
+## 0. 前提
+
+- AWS Lightsail 1 GB RAM / 40 GB SSD 以上 (IMAP fetch + Claude API + DB
+  write が同時に走るので 512 MB は不可)
+- Ubuntu 22.04 LTS (systemd 249+ — `OnUnitActiveSec` / `Persistent=true`
+  が安定して動くバージョン)
+- Node.js 20+ (corepack 経由で pnpm @ 9.x を解決)
+- PostgreSQL 16 (Lightsail Managed DB or self-hosted Docker、TLS 必須)
+- 専用 system user `kagetra` (sudo 不要、`/opt/kagetra` が home)
+- ドメイン + Let's Encrypt 証明書 (web 側別途、mail-worker 自体は HTTP
+  受け口を持たないので不要)
+
+## 1. 初回デプロイ
+
+1. system user 作成:
+
+   ```bash
+   sudo useradd -r -s /bin/bash -m -d /opt/kagetra kagetra
+   ```
+
+2. リポジトリ clone:
+
+   ```bash
+   sudo -u kagetra git clone https://github.com/poponta2020/kagetra_new.git /opt/kagetra
+   ```
+
+3. corepack + pnpm install (kagetra user で):
+
+   ```bash
+   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack enable && corepack pnpm install'
+   ```
+
+4. mail-worker を build:
+
+   ```bash
+   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/mail-worker build'
+   ```
+
+5. `.env.production` 配置 (owner `kagetra`, mode 0600):
+
+   ```bash
+   sudo -u kagetra install -m 0600 /dev/null /opt/kagetra/.env.production
+   sudo -u kagetra editor /opt/kagetra/.env.production
+   ```
+
+   中身の例 (値はダミー、実値に置換):
+
+   ```env
+   DATABASE_URL=postgres://kagetra:CHANGEME@db.example.com:5432/kagetra?sslmode=require
+   IMAP_HOST=imap.mail.yahoo.co.jp
+   IMAP_PORT=993
+   IMAP_USER=kagetra-import@yahoo.co.jp
+   IMAP_PASSWORD=CHANGEME
+   IMAP_MAILBOX=INBOX
+   ANTHROPIC_API_KEY=sk-ant-CHANGEME
+   # LINE は seed-system-channel.ts で DB に投入するため env 不要
+   # LOG_LEVEL=info
+   ```
+
+6. migration apply (PR1 〜 PR5 のスキーマを反映):
+
+   ```bash
+   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/shared db:migrate'
+   ```
+
+7. systemd unit 配置 + 有効化:
+
+   ```bash
+   sudo cp /opt/kagetra/apps/mail-worker/systemd/kagetra-mail-worker.service /etc/systemd/system/
+   sudo cp /opt/kagetra/apps/mail-worker/systemd/kagetra-mail-worker.timer /etc/systemd/system/
+   sudo systemctl daemon-reload
+   sudo systemctl enable --now kagetra-mail-worker.timer
+   ```
+
+## 2. LINE Bot 初期登録
+
+1. [LINE Developers Console](https://developers.line.biz/console/) で
+   新規 provider + Messaging API channel を作成
+2. Channel ID, Channel Secret, Channel Access Token (long-lived) を控える
+3. Bot 基本設定:
+   - Webhook URL: 不要 (PR5 では push のみ)
+   - Auto-reply / Greeting: お好みで OFF
+   - 「グループ・複数人トークへの参加を許可する」: 将来の P3-B (LINE
+     グループ転送) 用に **ON** にしておく
+4. 管理者 (= 通知受信者) が Bot を友だち追加
+5. Bot に何か発言してもらう → LINE Official Account Manager の管理画面で
+   `userId` (`U` で始まる 33 桁) を取得 (もしくは Webhook 一時受信で取得)
+6. seed-system-channel script を実行:
+
+   ```bash
+   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/mail-worker exec tsx scripts/seed-system-channel.ts \
+     --channel-id=2007xxxx \
+     --channel-secret=CHANGEME \
+     --access-token=CHANGEME \
+     --bot-id=@xxxx \
+     --notification-line-user-id=Uxxxxxxxx'
+   ```
+
+   2 回目以降の実行は UPDATE になる (idempotent)。token rotation 時は
+   §5 を参照。
+
+## 3. 動作確認
+
+- timer status:
+
+  ```bash
+  systemctl list-timers | grep kagetra
+  ```
+
+- 直近実行ログ:
+
+  ```bash
+  journalctl -u kagetra-mail-worker.service -n 50 --no-pager
+  ```
+
+- Web UI 確認: `/admin/mail-inbox` で「最近の取り込み履歴」セクションに
+  run が表示される
+- 手動 trigger: 同画面の「メール取り込み」ボタン → toast 表示 → 30 分
+  以内に履歴に反映 (timer 発火タイミング次第)
+- 即時実行したい場合:
+
+  ```bash
+  sudo systemctl start kagetra-mail-worker.service
+  ```
+
+## 4. トラブルシュート
+
+| 症状 | 原因と対応 |
+|---|---|
+| `LineSystemChannelNotConfiguredError` ログ | `seed-system-channel.ts` 未実行。§2 の手順 1〜6 を実施 |
+| 「pushSystemNotification skipped: no-user-id」 | seed 時に `--notification-line-user-id` 未指定。同じ script を `--notification-line-user-id=U...` 付きで再実行 (UPDATE される) |
+| LINE 401 / 403 ログ | Channel Access Token expire。LINE Developers Console で再発行 → §5 |
+| IMAP 認証失敗が連続 | Yahoo!Mail のアプリパスワード期限切れ。再発行 → `.env.production` 更新 → `sudo systemctl restart kagetra-mail-worker.service` (timer 自体は restart 不要) |
+| `tournament_drafts` が増えない | `journalctl -u kagetra-mail-worker.service` で `evaluator: classified=0` を確認。pre-filter rule (venue allow-list / sender) の意図確認 |
+| timer は走るが実行されない | `systemctl status kagetra-mail-worker.service` で exit code 確認、`journalctl -u kagetra-mail-worker.service` で詳細 |
+| 連続失敗で LINE 通知が止まらない | `mail_worker_runs` の `notified_imap_alert` / `notified_ai_alert` 列を確認。復旧後の成功 run で自動的に false にリセットされる |
+
+## 5. アクセストークン rotation
+
+1. [LINE Developers Console](https://developers.line.biz/console/) で
+   「Issue token (long-lived)」 → 新トークン発行
+2. `seed-system-channel.ts` を新トークンで再実行 (`status='system'` 行が
+   UPDATE される):
+
+   ```bash
+   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/mail-worker exec tsx scripts/seed-system-channel.ts \
+     --channel-id=2007xxxx \
+     --channel-secret=CHANGEME \
+     --access-token=NEW_TOKEN \
+     --bot-id=@xxxx \
+     --notification-line-user-id=Uxxxxxxxx'
+   ```
+
+3. 旧トークンを LINE Developers Console で revoke
+4. 動作確認: 任意の手動 trigger を打って通知が届くか確認
+
+   ```bash
+   sudo systemctl start kagetra-mail-worker.service
+   journalctl -u kagetra-mail-worker.service -n 30 --no-pager
+   ```
+
+## 6. 監視 (任意 / 将来)
+
+- v1: `journalctl -u kagetra-mail-worker.service` を sshd 越しに目視監視
+- 将来: `mail_worker_runs` の `status != 'success'` 件数を Lightsail
+  Alarms で監視
+- 将来: LINE で「3 回連続失敗」アラートが届くので、それを primary signal
+  にする (= 監視ツールを増やさない方針)
diff --git a/docs/features/mail-tournament-import/pr5-plan.md b/docs/features/mail-tournament-import/pr5-plan.md
new file mode 100644
index 0000000..15e5212
--- /dev/null
+++ b/docs/features/mail-tournament-import/pr5-plan.md
@@ -0,0 +1,303 @@
+---
+status: in_progress
+issue: 16
+parent_issue: 11
+branch: feat/mail-tournament-import-pr5
+worktree: /tmp/impl-mail-pr5
+---
+
+# PR5 実装計画 — 定期実行 + LINE 通知 + デプロイ配線
+
+PR4（[#20](https://github.com/poponta2020/kagetra_new/pull/20), `d1ec898`）で承認 UI と events 拡張までが揃った。本 PR で **(1) ジョブキューによる手動取り込み**、**(2) `mail_worker_runs` テーブル + 連続失敗判定**、**(3) `@line/bot-sdk` による LINE 通知**、**(4) systemd unit / timer 設定例 + デプロイ手順書** を追加し、Phase P3-A メール大会取り込みを close する。
+
+## 確定事項（2026-04-28 grill-me）
+
+| # | 質問 | 採用 |
+|---|---|---|
+| Q1 | 手動取り込み起動方式 | **A. `mail_worker_jobs` テーブル新設、Server Action は INSERT のみ。systemd timer 起動の worker が `pending` ジョブと定時 cron を統合実行** |
+| Q2 | 連続失敗判定 state | **A. `mail_worker_runs` テーブル新設（id, started_at, finished_at, summary jsonb, error text, kind('cron'\|'manual')）。直近 N 件で連続失敗判定（issue #16 のスコープ追加）** |
+| Q3 | 連続失敗判定対象 | **A. IMAP / AI 独立 2 系統（`mail_worker_runs.summary` に `imap_error: bool`, `ai_failed_count: int` を持たせる）** |
+| Q4 | LINE 通知集約 | **A. 上位 5 件まで件名列挙、超過分は「他 M 件」と省略** |
+| Q5 | 手動取り込み since UI | **A. プリセット（過去 24h / 3 日 / 7 日 / 任意日付）、デフォルト「過去 7 日」** |
+| Q6 | `seed-system-channel.ts` 引数 | **A. `--channel-id=... --secret=... --token=... --bot-id=... --notification-line-user-id=...` 引数指定 + `.env` fallback** |
+| Q7 | `@line/bot-sdk` バージョン | **`^11.0.0` を pin**（`npm view @line/bot-sdk version` 確認結果: 11.0.0） |
+| Q8 | マイグレーション番号 | **0010**（並行 PR なし、`packages/shared/drizzle/0009_nappy_kat_farrell.sql` の次） |
+
+## 既存資産（PR1-PR4 で揃っているもの）
+
+- `apps/mail-worker/src/pipeline.ts` — IMAP fetch → parse → classify → persist の cron 1 サイクル本体
+- `apps/mail-worker/src/index.ts` — エントリポイント、`--once` `--since` `--mock-imap` `--mock-llm` 既存
+- `apps/mail-worker/src/cli-args.ts` — `parseSinceArg` 既存（JST round-trip 対応済み、PR3 r3 で硬化）
+- `apps/mail-worker/src/classify/classifier.ts` — `classifyMail` + `persistOutcome` 純粋関数化済み
+- `apps/mail-worker/src/db.ts` — Drizzle Pool（既存）
+- `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `requireAdminSession()`、Server Action パターン（PR4 で確立）
+- `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` — 一覧画面、`<Suspense>` + Drawer / Modal の実装パターン
+- `users` テーブル（`packages/shared/src/schema/auth.ts`）— `line_login_id`, `display_name` まで存在、`line_channel_id` / `notification_line_user_id` は未追加
+- 全パッケージ test pattern（vitest + test DB + `mockAuthModule`）
+
+## 実装フェーズ
+
+### Phase 0: Worktree + branch
+- main から `feat/mail-tournament-import-pr5` を切る
+- worktree を `C:/tmp/impl-mail-pr5` に作成（Windows long-path 配慮で `C:/tmp/` 直下）
+- `corepack pnpm install` で全 package 解決
+- `npm view @line/bot-sdk version` 確認済み: `11.0.0`
+- migration 番号 0010 を予約
+
+### Phase 1: スキーマ追加（line_channels + users 拡張 + mail_worker_runs + mail_worker_jobs）
+
+#### 1a. enum 追加
+`packages/shared/src/schema/enums.ts`:
+```ts
+export const lineChannelStatusEnum = pgEnum('line_channel_status', [
+  'available', 'assigned', 'active', 'system', 'disabled',
+])
+
+// PR5 (mail-tournament-import)
+export const mailWorkerRunKindEnum = pgEnum('mail_worker_run_kind', ['cron', 'manual'])
+export const mailWorkerRunStatusEnum = pgEnum('mail_worker_run_status', [
+  'running', 'success', 'imap_failed', 'ai_failed', 'partial',
+])
+export const mailWorkerJobStatusEnum = pgEnum('mail_worker_job_status', [
+  'pending', 'claimed', 'done', 'failed',
+])
+```
+
+#### 1b. `packages/shared/src/schema/line-channels.ts` 新規
+- `id pk`, `channel_id text unique not null`, `channel_secret text not null`, `channel_access_token text not null`, `bot_id text not null`, `status lineChannelStatusEnum not null default 'available'`, `assigned_user_id integer fk → users.id nullable`, `notification_line_user_id text nullable`, `note text nullable`, `created_at`, `updated_at`
+
+#### 1c. `packages/shared/src/schema/auth.ts` 拡張
+- `users` に `line_channel_id integer fk → line_channels.id nullable`, `notification_line_user_id text nullable` を追加
+
+#### 1d. `packages/shared/src/schema/mail-worker.ts` 新規
+- `mail_worker_runs`:
+  - `id pk`, `started_at timestamp tz not null`, `finished_at timestamp tz nullable`, `kind mailWorkerRunKindEnum not null`, `status mailWorkerRunStatusEnum not null default 'running'`, `summary jsonb nullable`, `error text nullable`, `triggered_by_user_id integer fk → users.id nullable`, `since timestamp tz nullable`
+- `mail_worker_jobs`:
+  - `id pk`, `requested_at timestamp tz not null default now()`, `requested_by_user_id integer fk → users.id not null`, `since timestamp tz nullable`, `status mailWorkerJobStatusEnum not null default 'pending'`, `claimed_at timestamp tz nullable`, `run_id integer fk → mail_worker_runs.id nullable`, `error text nullable`, idx on `(status, requested_at)` for dispatcher poll
+
+#### 1e. `relations.ts` 更新
+- users ↔ line_channels（assigned_user 1:1, notification は単純 fk）
+- mail_worker_jobs → mail_worker_runs（FK）
+- mail_worker_runs → users (triggered_by)
+
+#### 1f. migration 生成
+- `corepack pnpm --filter @kagetra/shared db:generate` → `0010_<auto>.sql` 確認
+- `0010_*.sql` がカラム追加 11+ 個（line_channels 9, users 2, mail_worker_runs 9, mail_worker_jobs 7）+ enum 3 + idx 1 になることを目視確認
+- check-types pass
+
+### Phase 2: notify 層（LINE Bot SDK ラッパー + テンプレート）
+
+#### 2a. `apps/mail-worker/package.json`
+- `@line/bot-sdk: ^11.0.0` 追加（`npm view` 確認済み）
+- `corepack pnpm install`
+
+#### 2b. `apps/mail-worker/src/notify/line.ts` 新規
+- `getSystemChannel(db)`: `line_channels` から `status='system'` LIMIT 1（複数あれば最新）
+- `pushSystemNotification(db, message: string)`:
+  - getSystemChannel → token 取得 → `MessagingApiClient` で push
+  - `notification_line_user_id` を `to` に
+  - SDK エラーは catch して log + 例外 throw（pipeline 側で再 raise）
+  - test 向け: `LINE_NOTIFY_DRY_RUN=1` で実 push を skip し log のみ
+- `LineNotifyError` を export（pipeline 側 catch 用）
+
+#### 2c. `apps/mail-worker/src/notify/message-templates.ts` 新規
+- `buildNewDraftsMessage({ drafts: { subject: string }[] }) → string`
+  - 上位 5 件題名列挙、超過は「他 M 件」（Q4）
+  - 改行: `\n`
+  - 末尾に `→ /admin/mail-inbox` 付与
+- `buildErrorMessage({ kind: 'imap'|'ai', recentRuns: number, lastError: string }) → string`
+  - kind 別文言（IMAP: 「メール取り込みが連続 N 回 IMAP エラーで失敗」/ AI: 「AI 抽出が連続 N 件失敗」）
+  - lastError は最大 200 文字に切り詰め
+
+#### 2d. `apps/mail-worker/test/notify/line.test.ts` 新規
+- vi.mock で `@line/bot-sdk` の `MessagingApiClient` をモック化
+- `pushSystemNotification` 呼び出しで client.pushMessage が `to`/`messages` 引数で呼ばれること検証
+- `getSystemChannel` が `status='system'` 行を返す test DB 経由のテスト
+- テンプレート: `buildNewDraftsMessage` の 5 件 / 6 件分岐、`buildErrorMessage` の kind 別出力
+
+### Phase 3: pipeline 統合（mail_worker_runs 永続化 + 通知 hookup）
+
+#### 3a. `apps/mail-worker/src/pipeline.ts` 改修
+- 既存 `runOnce({ since, llm, mailbox })` を `runOnce({ since, llm, mailbox, kind, triggeredByUserId })` に拡張
+- 開始時に `mail_worker_runs` INSERT (`status='running'`)
+- 完了時に UPDATE (`finished_at`, `status`, `summary`, `error`)
+- summary jsonb shape:
+  ```ts
+  { fetched: number, classified: number, drafts_created: number, ai_failed: number, imap_error: boolean, errors: string[] }
+  ```
+- 通知判定（同じ pipeline の末尾、`mail_worker_runs` 永続化の後）:
+  - 新規 draft が 1 件以上 → `pushSystemNotification(buildNewDraftsMessage(...))`
+  - **連続失敗判定** (`evaluateConsecutiveFailures(db, runId)`):
+    - 直近 3 件 `mail_worker_runs` を `started_at desc` で取得
+    - 全件 `status IN ('imap_failed', 'partial')` かつ `summary.imap_error=true` → IMAP 異常通知
+    - 全件 `summary.ai_failed > 0` 累積 ≥ 3 → AI 異常通知
+    - 通知済みフラグ: 直近 1 件目に `summary.notified_imap_alert=true` を持たせて重複通知抑制（連続が解消するまで再送しない）
+
+#### 3b. `apps/mail-worker/src/jobs.ts` 新規（dispatcher）
+- `claimNextJob(db) → Job | null`:
+  - `UPDATE mail_worker_jobs SET status='claimed', claimed_at=now() WHERE id = (SELECT id FROM mail_worker_jobs WHERE status='pending' ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`
+  - SKIP LOCKED で並行実行 safe
+- `markJobDone(db, jobId, runId)` / `markJobFailed(db, jobId, error)`
+
+#### 3c. `apps/mail-worker/src/index.ts` 改修
+- 起動時のフロー:
+  1. `claimNextJob` を 1 回試す → ヒットすれば `kind='manual'`, `since=job.since`, `triggeredByUserId=job.requestedByUserId` で runOnce
+  2. ヒットしなければ `kind='cron'`, `since=defaultSinceForCron()` で runOnce
+  3. job がある場合は run 完了後に `markJobDone(jobId, runId)`
+- `--once` フラグは既存通り維持（dev でジョブ無しでも cron 1 回相当を回せる）
+- `--no-claim` フラグ追加（job 無視で純 cron 動作 = 既存挙動の復元、test/debug 用）
+
+#### 3d. test (`apps/mail-worker/test/pipeline-runs.test.ts` 新規)
+- `runOnce` が `mail_worker_runs` を `running` → `success` 遷移させる
+- 失敗時に `imap_failed` / `ai_failed` / `partial` に分岐
+- 連続 3 件失敗で `evaluateConsecutiveFailures` が `pushSystemNotification` を呼ぶ
+- 復旧後は `notified_imap_alert` フラグで再通知が抑制される
+- ジョブ claim → run → markDone のハッピーパス
+
+### Phase 4: web 側 Server Action + UI
+
+#### 4a. `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` に追加
+- `triggerMailFetch(formData) → { jobId: number }`:
+  1. `requireAdminSession()`
+  2. `since` を form から読み取り（プリセット → ms 換算 / 任意日付 → JST 0:00）
+  3. `mail_worker_jobs` INSERT（`requested_by_user_id = session.user.id`, `since`, `status='pending'`）
+  4. `revalidatePath('/admin/mail-inbox')`
+  5. 戻り値: `{ jobId }`（フロントは toast + 「ジョブ予約済み」表示、ポーリングは v1 では実装しない）
+
+#### 4b. `apps/web/src/app/(app)/admin/mail-inbox/components/TriggerFetchButton.tsx` 新規
+- ボタン押下 → ダイアログ open
+- ダイアログ内:
+  - ラジオ: 「過去 24 時間」/「過去 3 日」/「過去 7 日」（デフォルト）/「任意日付」
+  - 「任意日付」選択時: `<input type="date">` を有効化、値を JST 0:00 に
+  - 「実行」ボタンで `triggerMailFetch` 呼び出し
+- 成功時 toast「ジョブ #N を予約しました。次回 cron 実行 (~30 分以内) で処理されます」
+- shadcn Dialog + RadioGroup 使用
+
+#### 4c. `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` 改修
+- ヘッダー右上に `<TriggerFetchButton />` 配置
+- 既存 draft 一覧テーブルの上に「最近の取り込み履歴」セクション追加（`mail_worker_runs` 直近 5 件、kind / status / drafts_created / started_at の簡易表示）
+  - 失敗時は赤アイコン + error 文の hover tooltip
+
+#### 4d. `apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts` 拡張
+- `triggerMailFetch`:
+  - 認可 (admin/vice_admin OK / member NG)
+  - 各プリセットで `since` が正しく計算される（過去 24h / 3 日 / 7 日 / 任意日付）
+  - `mail_worker_jobs` に INSERT され `status='pending'`
+
+#### 4e. `apps/web/e2e/admin-mail-inbox-trigger.spec.ts` 新規
+- admin login → /admin/mail-inbox → 「メール取り込み」ボタン → ダイアログ → プリセット選択 → 実行 → toast 表示
+- 「最近の取り込み履歴」セクションが表示される（seed で 1 行入れる）
+
+### Phase 5: systemd unit + デプロイ手順書
+
+#### 5a. `apps/mail-worker/systemd/kagetra-mail-worker.service` 新規
+```ini
+[Unit]
+Description=Kagetra mail-worker (cron + job dispatcher)
+After=network.target
+
+[Service]
+Type=oneshot
+User=kagetra
+WorkingDirectory=/opt/kagetra
+EnvironmentFile=/opt/kagetra/.env.production
+ExecStart=/usr/bin/corepack pnpm --filter @kagetra/mail-worker exec node dist/index.js
+StandardOutput=journal
+StandardError=journal
+```
+
+#### 5b. `apps/mail-worker/systemd/kagetra-mail-worker.timer` 新規
+```ini
+[Unit]
+Description=Run kagetra mail-worker every 30 minutes
+Requires=kagetra-mail-worker.service
+
+[Timer]
+OnBootSec=2min
+OnUnitActiveSec=30min
+AccuracySec=1min
+Persistent=true
+
+[Install]
+WantedBy=timers.target
+```
+
+#### 5c. `apps/mail-worker/scripts/seed-system-channel.ts` 新規
+- 引数 parser:
+  - `--channel-id`, `--channel-secret`, `--access-token`, `--bot-id`, `--notification-line-user-id` (Q6)
+  - 全部 env (`LINE_SYSTEM_CHANNEL_*`) fallback
+  - 必須欠如時 throw（exit 1）
+- 既存 `status='system'` 行があれば UPDATE（access_token rotation 用途）、無ければ INSERT
+- dry-run フラグで実行内容のみ print
+
+#### 5d. `docs/deploy/mail-worker.md` 新規
+- 章立て:
+  1. 前提（Lightsail スペック, Node version, pnpm version, PostgreSQL 接続情報）
+  2. 初回デプロイ
+     - `git clone` / `corepack pnpm install` / `pnpm --filter ... build`
+     - `cp apps/mail-worker/systemd/*.service /etc/systemd/system/`（要 root）
+     - `systemctl daemon-reload && systemctl enable --now kagetra-mail-worker.timer`
+  3. LINE Bot 初期登録
+     - LINE Developers Console で Messaging API channel 作成
+     - 管理者が Bot を友だち追加 → webhook 経由で `userId` を取得（手段は別途）
+     - `pnpm tsx apps/mail-worker/scripts/seed-system-channel.ts --channel-id=... ...` 実行
+  4. 環境変数（`/opt/kagetra/.env.production` に置くもの）
+  5. 動作確認
+     - `journalctl -u kagetra-mail-worker.service -n 50`
+     - `/admin/mail-inbox` の最近の取り込み履歴で run が記録されているか
+  6. トラブルシュート（IMAP 認証失敗 / LINE 401 / DB 接続切れ）
+  7. アクセストークン rotation 手順（`seed-system-channel.ts` を再実行）
+
+### Phase 6: smoke test + 最終 QA
+
+- **mail-worker smoke**:
+  - `corepack pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --once --no-claim --mock-imap --mock-llm`
+  - exit 0、`mail_worker_runs` が 1 行作られ `status='success'`、新規 draft 数が log に出る
+- **手動取り込み smoke** (job dispatcher 経路):
+  - test DB に `mail_worker_jobs` を 1 行 INSERT
+  - `corepack pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --once --mock-imap --mock-llm`
+  - jobs.status='done'、runs.kind='manual', triggered_by_user_id 一致
+- **連続失敗 smoke**:
+  - test DB で `mail_worker_runs` を 3 件「imap_failed」で seed → 4 件目を mock IMAP 失敗で実行
+  - notify モックが called、4 件目の summary に `notified_imap_alert=true`
+- **`pnpm --filter @kagetra/web check-types` ✅**
+- **`pnpm --filter @kagetra/mail-worker check-types` ✅**
+- **`pnpm --filter @kagetra/shared db:check` ✅**
+- **`pnpm --filter @kagetra/web test` ✅**
+- **`pnpm --filter @kagetra/mail-worker test` ✅**
+- **`pnpm --filter @kagetra/web exec playwright test admin-mail-inbox-trigger` ✅**
+- ESLint clean
+- gh pr create with description (Closes #16, link to #11 / #20)
+
+## DoD (Issue #16 + grill 拡張)
+
+- [ ] `line_channels` / `mail_worker_runs` / `mail_worker_jobs` テーブルが migration 0010 で作成される
+- [ ] `users` に `line_channel_id` / `notification_line_user_id` 追加（既存挙動非破壊）
+- [ ] `pnpm tsx apps/mail-worker/scripts/seed-system-channel.ts --channel-id=... ...` で system 行 INSERT/UPDATE
+- [ ] mail-worker pipeline 末尾で LINE 通知が送信される（モック SDK で push 引数検証）
+- [ ] IMAP 連続 3 回失敗 / AI 連続 3 回失敗で異常時 LINE 通知（モック SDK で）
+- [ ] 復旧後の重複通知が `notified_imap_alert` で抑制される
+- [ ] `/admin/mail-inbox` の「メール取り込み」ボタン → ダイアログ → プリセット選択 → ジョブ予約
+- [ ] 「最近の取り込み履歴」セクションが直近 5 件の `mail_worker_runs` を表示
+- [ ] systemd service / timer 設定例ファイルが `apps/mail-worker/systemd/` に存在
+- [ ] `docs/deploy/mail-worker.md` にデプロイ手順 + LINE channel 初期登録 + rotation 手順
+- [ ] `pnpm tsx apps/mail-worker/src/index.ts --once --no-claim --mock-imap --mock-llm` smoke 成功
+- [ ] vitest で notify レイヤ + jobs dispatcher + runs 永続化の unit test が PASS
+- [ ] check-types / lint / vitest / E2E が CI 通過
+
+## スコープ外（明記）
+
+- LINE Login の `notification_line_user_id` 自動取得 webhook → 別 PR（Phase P3-A 後）
+- 100 channel プールの自動割当ロジック → P2 想定
+- AI 信頼度による自動承認 → v1 では採用しない（要件 §6.7 既決）
+- mail-worker のメトリクス可視化（Grafana 等）→ v1 では journalctl のみ
+- 異常時の SMS / メール fallback 通知 → 不要（LINE 単独）
+- ジョブ予約画面の進捗ポーリング UI → v1 では予約完了 toast のみ。次回 cron 実行 (~30 分以内) で処理される旨を表示
+
+## 想定外注意点（事前に明文化）
+
+- **dispatcher 競合**: systemd timer の `Type=oneshot` で多重起動はないが、手動の `systemctl start` を timer 動作中に叩くと重なる可能性あり。`mail_worker_jobs` の `FOR UPDATE SKIP LOCKED` で claim 競合は防げる。run の重複は許容（同じ since で 2 run 走っても draft の `UNIQUE(message_id)` で重複 INSERT は弾かれる）
+- **JST round-trip**: PR3 r3 の `parseSinceArg` 同様、Server Action 側 since も JST で渡す。プリセット「過去 24 時間」は `Date.now() - 24*3600*1000` の Date オブジェクト直渡しで OK（DB は timestamp tz）
+- **LINE SDK エラー**: 401 (token invalid) は通知失敗を log のみ（pipeline は continue）、500 系は再試行なし（次回 cron で再判定）
+- **連続失敗判定の境界**: `mail_worker_runs` 0 件状態（初回起動）では通知判定 skip
+- **SKIP LOCKED + integer FK**: `mail_worker_runs.id` を `mail_worker_jobs.run_id` に紐付ける際、claim 後に runs INSERT → jobs UPDATE の順で OK（claim 自体は run_id null）
diff --git a/packages/shared/drizzle/0010_panoramic_rattler.sql b/packages/shared/drizzle/0010_panoramic_rattler.sql
new file mode 100644
index 0000000..75606b6
--- /dev/null
+++ b/packages/shared/drizzle/0010_panoramic_rattler.sql
@@ -0,0 +1,49 @@
+CREATE TYPE "public"."line_channel_status" AS ENUM('available', 'assigned', 'active', 'system', 'disabled');--> statement-breakpoint
+CREATE TYPE "public"."mail_worker_job_status" AS ENUM('pending', 'claimed', 'done', 'failed');--> statement-breakpoint
+CREATE TYPE "public"."mail_worker_run_kind" AS ENUM('cron', 'manual');--> statement-breakpoint
+CREATE TYPE "public"."mail_worker_run_status" AS ENUM('running', 'success', 'imap_failed', 'ai_failed', 'partial');--> statement-breakpoint
+CREATE TABLE "line_channels" (
+	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "line_channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
+	"channel_id" text NOT NULL,
+	"channel_secret" text NOT NULL,
+	"channel_access_token" text NOT NULL,
+	"bot_id" text NOT NULL,
+	"status" "line_channel_status" DEFAULT 'available' NOT NULL,
+	"assigned_user_id" text,
+	"notification_line_user_id" text,
+	"note" text,
+	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
+	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
+	CONSTRAINT "line_channels_channel_id_unique" UNIQUE("channel_id")
+);
+--> statement-breakpoint
+CREATE TABLE "mail_worker_jobs" (
+	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_worker_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
+	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
+	"requested_by_user_id" text NOT NULL,
+	"since" timestamp with time zone,
+	"status" "mail_worker_job_status" DEFAULT 'pending' NOT NULL,
+	"claimed_at" timestamp with time zone,
+	"run_id" integer,
+	"error" text
+);
+--> statement-breakpoint
+CREATE TABLE "mail_worker_runs" (
+	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_worker_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
+	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
+	"finished_at" timestamp with time zone,
+	"kind" "mail_worker_run_kind" NOT NULL,
+	"status" "mail_worker_run_status" DEFAULT 'running' NOT NULL,
+	"summary" jsonb,
+	"error" text,
+	"triggered_by_user_id" text,
+	"since" timestamp with time zone
+);
+--> statement-breakpoint
+ALTER TABLE "users" ADD COLUMN "line_channel_id" integer;--> statement-breakpoint
+ALTER TABLE "users" ADD COLUMN "notification_line_user_id" text;--> statement-breakpoint
+ALTER TABLE "line_channels" ADD CONSTRAINT "line_channels_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
+ALTER TABLE "mail_worker_jobs" ADD CONSTRAINT "mail_worker_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
+ALTER TABLE "mail_worker_jobs" ADD CONSTRAINT "mail_worker_jobs_run_id_mail_worker_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mail_worker_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
+ALTER TABLE "mail_worker_runs" ADD CONSTRAINT "mail_worker_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
+CREATE INDEX "idx_mail_worker_jobs_status_requested_at" ON "mail_worker_jobs" USING btree ("status","requested_at");
\ No newline at end of file
diff --git a/packages/shared/drizzle/meta/0010_snapshot.json b/packages/shared/drizzle/meta/0010_snapshot.json
new file mode 100644
index 0000000..fecdf3d
--- /dev/null
+++ b/packages/shared/drizzle/meta/0010_snapshot.json
@@ -0,0 +1,1884 @@
+{
+  "id": "1898a312-40b2-477a-95e1-01dadaf2a46e",
+  "prevId": "de034a74-a914-4ea9-95d9-0bce6a22436e",
+  "version": "7",
+  "dialect": "postgresql",
+  "tables": {
+    "public.accounts": {
+      "name": "accounts",
+      "schema": "",
+      "columns": {
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "type": {
+          "name": "type",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "provider": {
+          "name": "provider",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "provider_account_id": {
+          "name": "provider_account_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "refresh_token": {
+          "name": "refresh_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "access_token": {
+          "name": "access_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "expires_at": {
+          "name": "expires_at",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "token_type": {
+          "name": "token_type",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "scope": {
+          "name": "scope",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "id_token": {
+          "name": "id_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "session_state": {
+          "name": "session_state",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "accounts_user_id_users_id_fk": {
+          "name": "accounts_user_id_users_id_fk",
+          "tableFrom": "accounts",
+          "tableTo": "users",
+          "columnsFrom": [
+            "user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {
+        "accounts_provider_provider_account_id_pk": {
+          "name": "accounts_provider_provider_account_id_pk",
+          "columns": [
+            "provider",
+            "provider_account_id"
+          ]
+        }
+      },
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.sessions": {
+      "name": "sessions",
+      "schema": "",
+      "columns": {
+        "session_token": {
+          "name": "session_token",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "expires": {
+          "name": "expires",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "sessions_user_id_users_id_fk": {
+          "name": "sessions_user_id_users_id_fk",
+          "tableFrom": "sessions",
+          "tableTo": "users",
+          "columnsFrom": [
+            "user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.users": {
+      "name": "users",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "email": {
+          "name": "email",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "email_verified": {
+          "name": "email_verified",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "image": {
+          "name": "image",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "line_user_id": {
+          "name": "line_user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "role": {
+          "name": "role",
+          "type": "user_role",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'member'"
+        },
+        "grade": {
+          "name": "grade",
+          "type": "grade",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "is_invited": {
+          "name": "is_invited",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "invited_at": {
+          "name": "invited_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "gender": {
+          "name": "gender",
+          "type": "gender",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "affiliation": {
+          "name": "affiliation",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "dan": {
+          "name": "dan",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "zen_nichikyo": {
+          "name": "zen_nichikyo",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "deactivated_at": {
+          "name": "deactivated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "line_linked_at": {
+          "name": "line_linked_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "line_link_method": {
+          "name": "line_link_method",
+          "type": "line_link_method",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "line_channel_id": {
+          "name": "line_channel_id",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "notification_line_user_id": {
+          "name": "notification_line_user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "users_name_unique": {
+          "name": "users_name_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "name"
+          ]
+        },
+        "users_email_unique": {
+          "name": "users_email_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "email"
+          ]
+        },
+        "users_line_user_id_unique": {
+          "name": "users_line_user_id_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "line_user_id"
+          ]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {
+        "users_dan_range": {
+          "name": "users_dan_range",
+          "value": "\"users\".\"dan\" BETWEEN 0 AND 9 OR \"users\".\"dan\" IS NULL"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.verification_tokens": {
+      "name": "verification_tokens",
+      "schema": "",
+      "columns": {
+        "identifier": {
+          "name": "identifier",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "token": {
+          "name": "token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "expires": {
+          "name": "expires",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {
+        "verification_tokens_identifier_token_pk": {
+          "name": "verification_tokens_identifier_token_pk",
+          "columns": [
+            "identifier",
+            "token"
+          ]
+        }
+      },
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.event_groups": {
+      "name": "event_groups",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "event_groups_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "event_groups_name_unique": {
+          "name": "event_groups_name_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "name"
+          ]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.events": {
+      "name": "events",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "events_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "title": {
+          "name": "title",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "event_date": {
+          "name": "event_date",
+          "type": "date",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "start_time": {
+          "name": "start_time",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "end_time": {
+          "name": "end_time",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "location": {
+          "name": "location",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "capacity": {
+          "name": "capacity",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "status": {
+          "name": "status",
+          "type": "event_status",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'draft'"
+        },
+        "created_by": {
+          "name": "created_by",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "formal_name": {
+          "name": "formal_name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "official": {
+          "name": "official",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": true
+        },
+        "kind": {
+          "name": "kind",
+          "type": "event_kind",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'individual'"
+        },
+        "entry_deadline": {
+          "name": "entry_deadline",
+          "type": "date",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "internal_deadline": {
+          "name": "internal_deadline",
+          "type": "date",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "event_group_id": {
+          "name": "event_group_id",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "eligible_grades": {
+          "name": "eligible_grades",
+          "type": "grade[]",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "fee_jpy": {
+          "name": "fee_jpy",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "payment_deadline": {
+          "name": "payment_deadline",
+          "type": "date",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "payment_info": {
+          "name": "payment_info",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "payment_method": {
+          "name": "payment_method",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "entry_method": {
+          "name": "entry_method",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "organizer": {
+          "name": "organizer",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "capacity_a": {
+          "name": "capacity_a",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "capacity_b": {
+          "name": "capacity_b",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "capacity_c": {
+          "name": "capacity_c",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "capacity_d": {
+          "name": "capacity_d",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "capacity_e": {
+          "name": "capacity_e",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "events_created_by_users_id_fk": {
+          "name": "events_created_by_users_id_fk",
+          "tableFrom": "events",
+          "tableTo": "users",
+          "columnsFrom": [
+            "created_by"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "events_event_group_id_event_groups_id_fk": {
+          "name": "events_event_group_id_event_groups_id_fk",
+          "tableFrom": "events",
+          "tableTo": "event_groups",
+          "columnsFrom": [
+            "event_group_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.event_attendances": {
+      "name": "event_attendances",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "event_attendances_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "event_id": {
+          "name": "event_id",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "attend": {
+          "name": "attend",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "comment": {
+          "name": "comment",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "event_attendances_event_id_events_id_fk": {
+          "name": "event_attendances_event_id_events_id_fk",
+          "tableFrom": "event_attendances",
+          "tableTo": "events",
+          "columnsFrom": [
+            "event_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "event_attendances_user_id_users_id_fk": {
+          "name": "event_attendances_user_id_users_id_fk",
+          "tableFrom": "event_attendances",
+          "tableTo": "users",
+          "columnsFrom": [
+            "user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "event_attendances_event_id_user_id_unique": {
+          "name": "event_attendances_event_id_user_id_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "event_id",
+            "user_id"
+          ]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.schedule_items": {
+      "name": "schedule_items",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "schedule_items_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "date": {
+          "name": "date",
+          "type": "date",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "kind": {
+          "name": "kind",
+          "type": "schedule_kind",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'other'"
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "start_time": {
+          "name": "start_time",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "end_time": {
+          "name": "end_time",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "location": {
+          "name": "location",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "owner_id": {
+          "name": "owner_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "schedule_items_owner_id_users_id_fk": {
+          "name": "schedule_items_owner_id_users_id_fk",
+          "tableFrom": "schedule_items",
+          "tableTo": "users",
+          "columnsFrom": [
+            "owner_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.mail_messages": {
+      "name": "mail_messages",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "mail_messages_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "message_id": {
+          "name": "message_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "from_address": {
+          "name": "from_address",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "from_name": {
+          "name": "from_name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "to_addresses": {
+          "name": "to_addresses",
+          "type": "text[]",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "subject": {
+          "name": "subject",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "received_at": {
+          "name": "received_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "body_text": {
+          "name": "body_text",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "body_html": {
+          "name": "body_html",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "status": {
+          "name": "status",
+          "type": "mail_message_status",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'pending'"
+        },
+        "classification": {
+          "name": "classification",
+          "type": "mail_classification",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "imap_uid": {
+          "name": "imap_uid",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "imap_box": {
+          "name": "imap_box",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "mail_messages_received_at_desc_idx": {
+          "name": "mail_messages_received_at_desc_idx",
+          "columns": [
+            {
+              "expression": "received_at",
+              "isExpression": false,
+              "asc": false,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "mail_messages_message_id_unique": {
+          "name": "mail_messages_message_id_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "message_id"
+          ]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.mail_attachments": {
+      "name": "mail_attachments",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "mail_attachments_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "mail_message_id": {
+          "name": "mail_message_id",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "filename": {
+          "name": "filename",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "content_type": {
+          "name": "content_type",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "size_bytes": {
+          "name": "size_bytes",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "data": {
+          "name": "data",
+          "type": "bytea",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "extracted_text": {
+          "name": "extracted_text",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "extraction_status": {
+          "name": "extraction_status",
+          "type": "attachment_extraction_status",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'pending'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "mail_attachments_mail_message_id_idx": {
+          "name": "mail_attachments_mail_message_id_idx",
+          "columns": [
+            {
+              "expression": "mail_message_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "mail_attachments_mail_message_id_mail_messages_id_fk": {
+          "name": "mail_attachments_mail_message_id_mail_messages_id_fk",
+          "tableFrom": "mail_attachments",
+          "tableTo": "mail_messages",
+          "columnsFrom": [
+            "mail_message_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.tournament_drafts": {
+      "name": "tournament_drafts",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "tournament_drafts_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "message_id": {
+          "name": "message_id",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "tournament_draft_status",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'pending_review'"
+        },
+        "confidence": {
+          "name": "confidence",
+          "type": "numeric(3, 2)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "is_correction": {
+          "name": "is_correction",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "references_subject": {
+          "name": "references_subject",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "superseded_by_draft_id": {
+          "name": "superseded_by_draft_id",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "extracted_payload": {
+          "name": "extracted_payload",
+          "type": "jsonb",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'{}'::jsonb"
+        },
+        "ai_raw_response": {
+          "name": "ai_raw_response",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "prompt_version": {
+          "name": "prompt_version",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "ai_model": {
+          "name": "ai_model",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "ai_tokens_input": {
+          "name": "ai_tokens_input",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "ai_tokens_output": {
+          "name": "ai_tokens_output",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "ai_cost_usd": {
+          "name": "ai_cost_usd",
+          "type": "numeric(10, 6)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "event_id": {
+          "name": "event_id",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "approved_by_user_id": {
+          "name": "approved_by_user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "approved_at": {
+          "name": "approved_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "rejected_by_user_id": {
+          "name": "rejected_by_user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "rejected_at": {
+          "name": "rejected_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "rejection_reason": {
+          "name": "rejection_reason",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_drafts_status_created": {
+          "name": "idx_drafts_status_created",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "created_at",
+              "isExpression": false,
+              "asc": false,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "tournament_drafts_message_id_mail_messages_id_fk": {
+          "name": "tournament_drafts_message_id_mail_messages_id_fk",
+          "tableFrom": "tournament_drafts",
+          "tableTo": "mail_messages",
+          "columnsFrom": [
+            "message_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "tournament_drafts_event_id_events_id_fk": {
+          "name": "tournament_drafts_event_id_events_id_fk",
+          "tableFrom": "tournament_drafts",
+          "tableTo": "events",
+          "columnsFrom": [
+            "event_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        },
+        "tournament_drafts_approved_by_user_id_users_id_fk": {
+          "name": "tournament_drafts_approved_by_user_id_users_id_fk",
+          "tableFrom": "tournament_drafts",
+          "tableTo": "users",
+          "columnsFrom": [
+            "approved_by_user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        },
+        "tournament_drafts_rejected_by_user_id_users_id_fk": {
+          "name": "tournament_drafts_rejected_by_user_id_users_id_fk",
+          "tableFrom": "tournament_drafts",
+          "tableTo": "users",
+          "columnsFrom": [
+            "rejected_by_user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "tournament_drafts_message_id_unique": {
+          "name": "tournament_drafts_message_id_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "message_id"
+          ]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {
+        "tournament_drafts_confidence_range": {
+          "name": "tournament_drafts_confidence_range",
+          "value": "\"tournament_drafts\".\"confidence\" BETWEEN 0 AND 1 OR \"tournament_drafts\".\"confidence\" IS NULL"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.line_channels": {
+      "name": "line_channels",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "line_channels_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "channel_id": {
+          "name": "channel_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "channel_secret": {
+          "name": "channel_secret",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "channel_access_token": {
+          "name": "channel_access_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "bot_id": {
+          "name": "bot_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "line_channel_status",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'available'"
+        },
+        "assigned_user_id": {
+          "name": "assigned_user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "notification_line_user_id": {
+          "name": "notification_line_user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "note": {
+          "name": "note",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "line_channels_assigned_user_id_users_id_fk": {
+          "name": "line_channels_assigned_user_id_users_id_fk",
+          "tableFrom": "line_channels",
+          "tableTo": "users",
+          "columnsFrom": [
+            "assigned_user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "line_channels_channel_id_unique": {
+          "name": "line_channels_channel_id_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "channel_id"
+          ]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.mail_worker_jobs": {
+      "name": "mail_worker_jobs",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "mail_worker_jobs_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "requested_at": {
+          "name": "requested_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "requested_by_user_id": {
+          "name": "requested_by_user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "since": {
+          "name": "since",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "status": {
+          "name": "status",
+          "type": "mail_worker_job_status",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'pending'"
+        },
+        "claimed_at": {
+          "name": "claimed_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "run_id": {
+          "name": "run_id",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "error": {
+          "name": "error",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "idx_mail_worker_jobs_status_requested_at": {
+          "name": "idx_mail_worker_jobs_status_requested_at",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "requested_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "mail_worker_jobs_requested_by_user_id_users_id_fk": {
+          "name": "mail_worker_jobs_requested_by_user_id_users_id_fk",
+          "tableFrom": "mail_worker_jobs",
+          "tableTo": "users",
+          "columnsFrom": [
+            "requested_by_user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "mail_worker_jobs_run_id_mail_worker_runs_id_fk": {
+          "name": "mail_worker_jobs_run_id_mail_worker_runs_id_fk",
+          "tableFrom": "mail_worker_jobs",
+          "tableTo": "mail_worker_runs",
+          "columnsFrom": [
+            "run_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.mail_worker_runs": {
+      "name": "mail_worker_runs",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "mail_worker_runs_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        },
+        "started_at": {
+          "name": "started_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "finished_at": {
+          "name": "finished_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "kind": {
+          "name": "kind",
+          "type": "mail_worker_run_kind",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "mail_worker_run_status",
+          "typeSchema": "public",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'running'"
+        },
+        "summary": {
+          "name": "summary",
+          "type": "jsonb",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "error": {
+          "name": "error",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "triggered_by_user_id": {
+          "name": "triggered_by_user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "since": {
+          "name": "since",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "mail_worker_runs_triggered_by_user_id_users_id_fk": {
+          "name": "mail_worker_runs_triggered_by_user_id_users_id_fk",
+          "tableFrom": "mail_worker_runs",
+          "tableTo": "users",
+          "columnsFrom": [
+            "triggered_by_user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    }
+  },
+  "enums": {
+    "public.attachment_extraction_status": {
+      "name": "attachment_extraction_status",
+      "schema": "public",
+      "values": [
+        "pending",
+        "extracted",
+        "failed",
+        "unsupported"
+      ]
+    },
+    "public.event_kind": {
+      "name": "event_kind",
+      "schema": "public",
+      "values": [
+        "individual",
+        "team"
+      ]
+    },
+    "public.event_status": {
+      "name": "event_status",
+      "schema": "public",
+      "values": [
+        "draft",
+        "published",
+        "cancelled",
+        "done"
+      ]
+    },
+    "public.gender": {
+      "name": "gender",
+      "schema": "public",
+      "values": [
+        "male",
+        "female"
+      ]
+    },
+    "public.grade": {
+      "name": "grade",
+      "schema": "public",
+      "values": [
+        "A",
+        "B",
+        "C",
+        "D",
+        "E"
+      ]
+    },
+    "public.line_channel_status": {
+      "name": "line_channel_status",
+      "schema": "public",
+      "values": [
+        "available",
+        "assigned",
+        "active",
+        "system",
+        "disabled"
+      ]
+    },
+    "public.line_link_method": {
+      "name": "line_link_method",
+      "schema": "public",
+      "values": [
+        "self_identify",
+        "admin_link",
+        "account_switch"
+      ]
+    },
+    "public.mail_classification": {
+      "name": "mail_classification",
+      "schema": "public",
+      "values": [
+        "tournament",
+        "noise",
+        "unknown"
+      ]
+    },
+    "public.mail_message_status": {
+      "name": "mail_message_status",
+      "schema": "public",
+      "values": [
+        "pending",
+        "fetched",
+        "parse_failed",
+        "fetch_failed",
+        "ai_processing",
+        "ai_done",
+        "ai_failed",
+        "archived"
+      ]
+    },
+    "public.mail_worker_job_status": {
+      "name": "mail_worker_job_status",
+      "schema": "public",
+      "values": [
+        "pending",
+        "claimed",
+        "done",
+        "failed"
+      ]
+    },
+    "public.mail_worker_run_kind": {
+      "name": "mail_worker_run_kind",
+      "schema": "public",
+      "values": [
+        "cron",
+        "manual"
+      ]
+    },
+    "public.mail_worker_run_status": {
+      "name": "mail_worker_run_status",
+      "schema": "public",
+      "values": [
+        "running",
+        "success",
+        "imap_failed",
+        "ai_failed",
+        "partial"
+      ]
+    },
+    "public.schedule_kind": {
+      "name": "schedule_kind",
+      "schema": "public",
+      "values": [
+        "practice",
+        "meeting",
+        "social",
+        "other"
+      ]
+    },
+    "public.tournament_draft_status": {
+      "name": "tournament_draft_status",
+      "schema": "public",
+      "values": [
+        "pending_review",
+        "approved",
+        "rejected",
+        "ai_failed",
+        "superseded"
+      ]
+    },
+    "public.user_role": {
+      "name": "user_role",
+      "schema": "public",
+      "values": [
+        "admin",
+        "vice_admin",
+        "member"
+      ]
+    }
+  },
+  "schemas": {},
+  "sequences": {},
+  "roles": {},
+  "policies": {},
+  "views": {},
+  "_meta": {
+    "columns": {},
+    "schemas": {},
+    "tables": {}
+  }
+}
\ No newline at end of file
diff --git a/packages/shared/drizzle/meta/_journal.json b/packages/shared/drizzle/meta/_journal.json
index d444cd1..a01c2e4 100644
--- a/packages/shared/drizzle/meta/_journal.json
+++ b/packages/shared/drizzle/meta/_journal.json
@@ -71,6 +71,13 @@
       "when": 1777218927459,
       "tag": "0009_nappy_kat_farrell",
       "breakpoints": true
+    },
+    {
+      "idx": 10,
+      "version": "7",
+      "when": 1777346029755,
+      "tag": "0010_panoramic_rattler",
+      "breakpoints": true
     }
   ]
 }
\ No newline at end of file
diff --git a/packages/shared/src/schema/auth.ts b/packages/shared/src/schema/auth.ts
index 2eeffa8..4d7d8b8 100644
--- a/packages/shared/src/schema/auth.ts
+++ b/packages/shared/src/schema/auth.ts
@@ -35,6 +35,12 @@ export const users = pgTable(
     lineLinkedMethod: lineLinkMethodEnum('line_link_method'),
     createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
     updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
+    // PR5 (mail-tournament-import): per-user LINE Messaging channel assignment.
+    // FK to line_channels.id is declared in line_channels.ts (assigned_user_id)
+    // to avoid a circular import; here we keep the reverse pointer as a plain
+    // integer column and wire up the relation in relations.ts.
+    lineChannelId: integer('line_channel_id'),
+    notificationLineUserId: text('notification_line_user_id'),
   },
   (table) => [
     // dan is 段位 (kyu/dan rank). Valid range is 0–9; enforce at the DB layer
diff --git a/packages/shared/src/schema/enums.ts b/packages/shared/src/schema/enums.ts
index 908ccb2..89fc14f 100644
--- a/packages/shared/src/schema/enums.ts
+++ b/packages/shared/src/schema/enums.ts
@@ -45,3 +45,26 @@ export const tournamentDraftStatusEnum = pgEnum('tournament_draft_status', [
   'ai_failed',
   'superseded',
 ])
+
+// PR5 (mail-tournament-import)
+export const lineChannelStatusEnum = pgEnum('line_channel_status', [
+  'available',
+  'assigned',
+  'active',
+  'system',
+  'disabled',
+])
+export const mailWorkerRunKindEnum = pgEnum('mail_worker_run_kind', ['cron', 'manual'])
+export const mailWorkerRunStatusEnum = pgEnum('mail_worker_run_status', [
+  'running',
+  'success',
+  'imap_failed',
+  'ai_failed',
+  'partial',
+])
+export const mailWorkerJobStatusEnum = pgEnum('mail_worker_job_status', [
+  'pending',
+  'claimed',
+  'done',
+  'failed',
+])
diff --git a/packages/shared/src/schema/index.ts b/packages/shared/src/schema/index.ts
index 17b09ea..0cef8e4 100644
--- a/packages/shared/src/schema/index.ts
+++ b/packages/shared/src/schema/index.ts
@@ -7,4 +7,6 @@ export * from './schedule-items'
 export * from './mail-messages'
 export * from './mail-attachments'
 export * from './tournament-drafts'
+export * from './line-channels'
+export * from './mail-worker'
 export * from './relations'
diff --git a/packages/shared/src/schema/line-channels.ts b/packages/shared/src/schema/line-channels.ts
new file mode 100644
index 0000000..daf3243
--- /dev/null
+++ b/packages/shared/src/schema/line-channels.ts
@@ -0,0 +1,32 @@
+import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
+import { lineChannelStatusEnum } from './enums'
+import { users } from './auth'
+
+/**
+ * line_channels: pool of LINE Messaging API channels managed by the system.
+ *
+ * One row per provisioned LINE channel. The `system` status row is consumed by
+ * the mail-worker for admin notifications (new draft created, IMAP/AI failure
+ * alerts). `assigned`/`active` rows reserve a channel for an individual user
+ * (Phase 2, scope-out for PR5). `available` rows form the unassigned pool.
+ *
+ * `assigned_user_id` is the FK to users; the reverse pointer
+ * `users.line_channel_id` is intentionally declared without a SQL FK constraint
+ * to break the circular import between auth.ts and line-channels.ts. The
+ * relation is wired up in `relations.ts` so Drizzle ORM joins still work.
+ */
+export const lineChannels = pgTable('line_channels', {
+  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
+  channelId: text('channel_id').notNull().unique(),
+  channelSecret: text('channel_secret').notNull(),
+  channelAccessToken: text('channel_access_token').notNull(),
+  botId: text('bot_id').notNull(),
+  status: lineChannelStatusEnum('status').notNull().default('available'),
+  assignedUserId: text('assigned_user_id').references(() => users.id, {
+    onDelete: 'set null',
+  }),
+  notificationLineUserId: text('notification_line_user_id'),
+  note: text('note'),
+  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
+  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
+})
diff --git a/packages/shared/src/schema/mail-worker.ts b/packages/shared/src/schema/mail-worker.ts
new file mode 100644
index 0000000..57bd6ae
--- /dev/null
+++ b/packages/shared/src/schema/mail-worker.ts
@@ -0,0 +1,64 @@
+import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
+import {
+  mailWorkerJobStatusEnum,
+  mailWorkerRunKindEnum,
+  mailWorkerRunStatusEnum,
+} from './enums'
+import { users } from './auth'
+
+/**
+ * mail_worker_runs: one row per mail-worker invocation (cron or manual).
+ *
+ * Inserted with `status='running'` at the start of `runOnce` and updated to
+ * the terminal status (`success` / `imap_failed` / `ai_failed` / `partial`)
+ * when the pipeline finishes. `summary` is the JSON shape used by
+ * `evaluateConsecutiveFailures` to detect IMAP/AI alert conditions.
+ *
+ * `triggered_by_user_id` is set only for `kind='manual'` runs (claimed from
+ * `mail_worker_jobs`); cron runs leave it null.
+ */
+export const mailWorkerRuns = pgTable('mail_worker_runs', {
+  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
+  startedAt: timestamp('started_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
+  finishedAt: timestamp('finished_at', { mode: 'date', withTimezone: true }),
+  kind: mailWorkerRunKindEnum('kind').notNull(),
+  status: mailWorkerRunStatusEnum('status').notNull().default('running'),
+  summary: jsonb('summary'),
+  error: text('error'),
+  triggeredByUserId: text('triggered_by_user_id').references(() => users.id, {
+    onDelete: 'set null',
+  }),
+  since: timestamp('since', { mode: 'date', withTimezone: true }),
+})
+
+/**
+ * mail_worker_jobs: queue of admin-requested mail fetch invocations.
+ *
+ * Server Action inserts a row with `status='pending'`; the mail-worker
+ * dispatcher claims it via `FOR UPDATE SKIP LOCKED`, executes a manual
+ * `runOnce`, then UPDATEs the job to `done`/`failed` with `run_id` set to the
+ * created `mail_worker_runs.id`.
+ *
+ * The `(status, requested_at)` index supports the dispatcher's "oldest pending
+ * job first" claim query.
+ */
+export const mailWorkerJobs = pgTable(
+  'mail_worker_jobs',
+  {
+    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
+    requestedAt: timestamp('requested_at', { mode: 'date', withTimezone: true })
+      .notNull()
+      .defaultNow(),
+    requestedByUserId: text('requested_by_user_id')
+      .notNull()
+      .references(() => users.id, { onDelete: 'cascade' }),
+    since: timestamp('since', { mode: 'date', withTimezone: true }),
+    status: mailWorkerJobStatusEnum('status').notNull().default('pending'),
+    claimedAt: timestamp('claimed_at', { mode: 'date', withTimezone: true }),
+    runId: integer('run_id').references(() => mailWorkerRuns.id, { onDelete: 'set null' }),
+    error: text('error'),
+  },
+  (table) => [
+    index('idx_mail_worker_jobs_status_requested_at').on(table.status, table.requestedAt),
+  ],
+)
diff --git a/packages/shared/src/schema/relations.ts b/packages/shared/src/schema/relations.ts
index daf3e7f..a55f63a 100644
--- a/packages/shared/src/schema/relations.ts
+++ b/packages/shared/src/schema/relations.ts
@@ -7,6 +7,8 @@ import { scheduleItems } from './schedule-items'
 import { mailMessages } from './mail-messages'
 import { mailAttachments } from './mail-attachments'
 import { tournamentDrafts } from './tournament-drafts'
+import { lineChannels } from './line-channels'
+import { mailWorkerJobs, mailWorkerRuns } from './mail-worker'
 
 export const eventGroupsRelations = relations(eventGroups, ({ many }) => ({
   events: many(events),
@@ -35,8 +37,14 @@ export const eventAttendancesRelations = relations(eventAttendances, ({ one }) =
   }),
 }))
 
-export const usersRelations = relations(users, ({ many }) => ({
+export const usersRelations = relations(users, ({ one, many }) => ({
   attendances: many(eventAttendances),
+  // PR5: per-user assigned LINE Messaging channel (FK declared on
+  // line_channels.assignedUserId; relation wired here to avoid circular import).
+  lineChannel: one(lineChannels, {
+    fields: [users.lineChannelId],
+    references: [lineChannels.id],
+  }),
 }))
 
 export const scheduleItemsRelations = relations(scheduleItems, ({ one }) => ({
@@ -71,3 +79,30 @@ export const tournamentDraftsRelations = relations(tournamentDrafts, ({ one }) =
     references: [events.id],
   }),
 }))
+
+// PR5 (mail-tournament-import)
+export const lineChannelsRelations = relations(lineChannels, ({ one }) => ({
+  assignedUser: one(users, {
+    fields: [lineChannels.assignedUserId],
+    references: [users.id],
+  }),
+}))
+
+export const mailWorkerRunsRelations = relations(mailWorkerRuns, ({ one, many }) => ({
+  triggeredBy: one(users, {
+    fields: [mailWorkerRuns.triggeredByUserId],
+    references: [users.id],
+  }),
+  jobs: many(mailWorkerJobs),
+}))
+
+export const mailWorkerJobsRelations = relations(mailWorkerJobs, ({ one }) => ({
+  requestedBy: one(users, {
+    fields: [mailWorkerJobs.requestedByUserId],
+    references: [users.id],
+  }),
+  run: one(mailWorkerRuns, {
+    fields: [mailWorkerJobs.runId],
+    references: [mailWorkerRuns.id],
+  }),
+}))
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 7b8868e..c7e4686 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -22,7 +22,7 @@ importers:
         version: 16.3.2(@testing-library/dom@10.4.1)(@types/react-dom@19.2.3(@types/react@19.2.14))(@types/react@19.2.14)(react-dom@19.2.5(react@19.2.5))(react@19.2.5)
       '@vitejs/plugin-react':
         specifier: ^4.3.0
-        version: 4.7.0(vite@7.3.2(@types/node@22.19.17)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0))
+        version: 4.7.0(vite@7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0))
       cross-env:
         specifier: ^7.0.3
         version: 7.0.3
@@ -34,10 +34,10 @@ importers:
         version: 2.9.6
       vite-tsconfig-paths:
         specifier: ^5.0.0
-        version: 5.1.4(typescript@5.9.3)(vite@7.3.2(@types/node@22.19.17)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0))
+        version: 5.1.4(typescript@5.9.3)(vite@7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0))
       vitest:
         specifier: ^3.2.0
-        version: 3.2.4(@types/node@22.19.17)(jiti@2.6.1)(jsdom@25.0.1)(lightningcss@1.32.0)(tsx@4.21.0)
+        version: 3.2.4(@types/node@24.12.2)(jiti@2.6.1)(jsdom@25.0.1)(lightningcss@1.32.0)(tsx@4.21.0)
 
   apps/api:
     dependencies:
@@ -93,6 +93,9 @@ importers:
       '@kagetra/shared':
         specifier: workspace:*
         version: link:../../packages/shared
+      '@line/bot-sdk':
+        specifier: ^11.0.0
+        version: 11.0.0
       dotenv:
         specifier: ^16.4.0
         version: 16.6.1
@@ -1108,6 +1111,10 @@ packages:
   '@jridgewell/trace-mapping@0.3.31':
     resolution: {integrity: sha512-zzNR+SdQSDJzc8joaeP8QQoCQr8NuYx2dIIytl1QeBEZHJ9uW6hebsrYgbz8hJwUQao3TWCMtmfV8Nu1twOLAw==}
 
+  '@line/bot-sdk@11.0.0':
+    resolution: {integrity: sha512-3NZJjeFm2BikwVRgA8osIVbgKhuL0CzphQOdrB8okXIC40qMRE4RRfHFN3G8/qTb/34RtB95mD4J/KW5MD+b8g==}
+    engines: {node: '>=20'}
+
   '@napi-rs/canvas-android-arm64@0.1.99':
     resolution: {integrity: sha512-9OCRt8VVxA17m32NWZKyNC2qamdaS/SC5CEOIQwFngRq0DIeVm4PDal+6Ljnhqm2whZiC63DNuKZ4xSp2nbj9w==}
     engines: {node: '>= 10'}
@@ -1582,6 +1589,9 @@ packages:
   '@types/node@22.19.17':
     resolution: {integrity: sha512-wGdMcf+vPYM6jikpS/qhg6WiqSV/OhG+jeeHT/KlVqxYfD40iYJf9/AE1uQxVWFvU7MipKRkRv8NSHiCGgPr8Q==}
 
+  '@types/node@24.12.2':
+    resolution: {integrity: sha512-A1sre26ke7HDIuY/M23nd9gfB+nrmhtYyMINbjI1zHJxYteKR6qSMX56FsmjMcDb3SMcjJg5BiRRgOCC/yBD0g==}
+
   '@types/pg@8.20.0':
     resolution: {integrity: sha512-bEPFOaMAHTEP1EzpvHTbmwR8UsFyHSKsRisLIHVMXnpNefSbGA1bD6CVy+qKjGSqmZqNqBDV2azOBo8TgkcVow==}
 
@@ -3824,6 +3834,9 @@ packages:
   undici-types@6.21.0:
     resolution: {integrity: sha512-iwDZqg0QAGrg9Rav5H4n0M64c3mkR59cJ6wQp+7C4nI0gsmExaedaYLNO44eT4AtBBwjbTiGPMlt2Md0T9H9JQ==}
 
+  undici-types@7.16.0:
+    resolution: {integrity: sha512-Zz+aZWSj8LE6zoxD+xrjh4VfkIG8Ya6LvYkZqtUQGJPZjYl53ypCaUwWqo7eI0x66KBGeRo+mlBEkMSeSZ38Nw==}
+
   unrs-resolver@1.11.1:
     resolution: {integrity: sha512-bSjt9pjaEBnNiGgc9rUiHGKv5l4/TGzDmYw3RhnkJGtLhbnnA/5qJj7x3dNDCRx/PJxu774LlH8lCOlB4hEfKg==}
 
@@ -4618,6 +4631,10 @@ snapshots:
       '@jridgewell/resolve-uri': 3.1.2
       '@jridgewell/sourcemap-codec': 1.5.5
 
+  '@line/bot-sdk@11.0.0':
+    dependencies:
+      '@types/node': 24.12.2
+
   '@napi-rs/canvas-android-arm64@0.1.99':
     optional: true
 
@@ -4982,6 +4999,10 @@ snapshots:
     dependencies:
       undici-types: 6.21.0
 
+  '@types/node@24.12.2':
+    dependencies:
+      undici-types: 7.16.0
+
   '@types/pg@8.20.0':
     dependencies:
       '@types/node': 22.19.17
@@ -5146,7 +5167,7 @@ snapshots:
   '@unrs/resolver-binding-win32-x64-msvc@1.11.1':
     optional: true
 
-  '@vitejs/plugin-react@4.7.0(vite@7.3.2(@types/node@22.19.17)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0))':
+  '@vitejs/plugin-react@4.7.0(vite@7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0))':
     dependencies:
       '@babel/core': 7.29.0
       '@babel/plugin-transform-react-jsx-self': 7.27.1(@babel/core@7.29.0)
@@ -5154,7 +5175,7 @@ snapshots:
       '@rolldown/pluginutils': 1.0.0-beta.27
       '@types/babel__core': 7.20.5
       react-refresh: 0.17.0
-      vite: 7.3.2(@types/node@22.19.17)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
+      vite: 7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
     transitivePeerDependencies:
       - supports-color
 
@@ -5174,6 +5195,14 @@ snapshots:
     optionalDependencies:
       vite: 7.3.2(@types/node@22.19.17)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
 
+  '@vitest/mocker@3.2.4(vite@7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0))':
+    dependencies:
+      '@vitest/spy': 3.2.4
+      estree-walker: 3.0.3
+      magic-string: 0.30.21
+    optionalDependencies:
+      vite: 7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
+
   '@vitest/pretty-format@3.2.4':
     dependencies:
       tinyrainbow: 2.0.0
@@ -7458,6 +7487,8 @@ snapshots:
 
   undici-types@6.21.0: {}
 
+  undici-types@7.16.0: {}
+
   unrs-resolver@1.11.1:
     dependencies:
       napi-postinstall: 0.3.4
@@ -7515,13 +7546,34 @@ snapshots:
       - tsx
       - yaml
 
-  vite-tsconfig-paths@5.1.4(typescript@5.9.3)(vite@7.3.2(@types/node@22.19.17)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)):
+  vite-node@3.2.4(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0):
+    dependencies:
+      cac: 6.7.14
+      debug: 4.4.3
+      es-module-lexer: 1.7.0
+      pathe: 2.0.3
+      vite: 7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
+    transitivePeerDependencies:
+      - '@types/node'
+      - jiti
+      - less
+      - lightningcss
+      - sass
+      - sass-embedded
+      - stylus
+      - sugarss
+      - supports-color
+      - terser
+      - tsx
+      - yaml
+
+  vite-tsconfig-paths@5.1.4(typescript@5.9.3)(vite@7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)):
     dependencies:
       debug: 4.4.3
       globrex: 0.1.2
       tsconfck: 3.1.6(typescript@5.9.3)
     optionalDependencies:
-      vite: 7.3.2(@types/node@22.19.17)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
+      vite: 7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
     transitivePeerDependencies:
       - supports-color
       - typescript
@@ -7541,6 +7593,21 @@ snapshots:
       lightningcss: 1.32.0
       tsx: 4.21.0
 
+  vite@7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0):
+    dependencies:
+      esbuild: 0.27.7
+      fdir: 6.5.0(picomatch@4.0.4)
+      picomatch: 4.0.4
+      postcss: 8.5.9
+      rollup: 4.60.1
+      tinyglobby: 0.2.16
+    optionalDependencies:
+      '@types/node': 24.12.2
+      fsevents: 2.3.3
+      jiti: 2.6.1
+      lightningcss: 1.32.0
+      tsx: 4.21.0
+
   vitest@3.2.4(@types/node@22.19.17)(jiti@2.6.1)(jsdom@25.0.1)(lightningcss@1.32.0)(tsx@4.21.0):
     dependencies:
       '@types/chai': 5.2.3
@@ -7583,6 +7650,48 @@ snapshots:
       - tsx
       - yaml
 
+  vitest@3.2.4(@types/node@24.12.2)(jiti@2.6.1)(jsdom@25.0.1)(lightningcss@1.32.0)(tsx@4.21.0):
+    dependencies:
+      '@types/chai': 5.2.3
+      '@vitest/expect': 3.2.4
+      '@vitest/mocker': 3.2.4(vite@7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0))
+      '@vitest/pretty-format': 3.2.4
+      '@vitest/runner': 3.2.4
+      '@vitest/snapshot': 3.2.4
+      '@vitest/spy': 3.2.4
+      '@vitest/utils': 3.2.4
+      chai: 5.3.3
+      debug: 4.4.3
+      expect-type: 1.3.0
+      magic-string: 0.30.21
+      pathe: 2.0.3
+      picomatch: 4.0.4
+      std-env: 3.10.0
+      tinybench: 2.9.0
+      tinyexec: 0.3.2
+      tinyglobby: 0.2.16
+      tinypool: 1.1.1
+      tinyrainbow: 2.0.0
+      vite: 7.3.2(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
+      vite-node: 3.2.4(@types/node@24.12.2)(jiti@2.6.1)(lightningcss@1.32.0)(tsx@4.21.0)
+      why-is-node-running: 2.3.0
+    optionalDependencies:
+      '@types/node': 24.12.2
+      jsdom: 25.0.1
+    transitivePeerDependencies:
+      - jiti
+      - less
+      - lightningcss
+      - msw
+      - sass
+      - sass-embedded
+      - stylus
+      - sugarss
+      - supports-color
+      - terser
+      - tsx
+      - yaml
+
   w3c-xmlserializer@5.0.0:
     dependencies:
       xml-name-validator: 5.0.0
```

---

## レビュー結果の記録先

Codex が返した結果は **scripts/review/output/review-result-pr21-1.md** に貼り付けてください（`/fix` が参照します）。
