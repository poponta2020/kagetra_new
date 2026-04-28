---
status: in_progress
issue: 16
parent_issue: 11
branch: feat/mail-tournament-import-pr5
worktree: /tmp/impl-mail-pr5
---

# PR5 実装計画 — 定期実行 + LINE 通知 + デプロイ配線

PR4（[#20](https://github.com/poponta2020/kagetra_new/pull/20), `d1ec898`）で承認 UI と events 拡張までが揃った。本 PR で **(1) ジョブキューによる手動取り込み**、**(2) `mail_worker_runs` テーブル + 連続失敗判定**、**(3) `@line/bot-sdk` による LINE 通知**、**(4) systemd unit / timer 設定例 + デプロイ手順書** を追加し、Phase P3-A メール大会取り込みを close する。

## 確定事項（2026-04-28 grill-me）

| # | 質問 | 採用 |
|---|---|---|
| Q1 | 手動取り込み起動方式 | **A. `mail_worker_jobs` テーブル新設、Server Action は INSERT のみ。systemd timer 起動の worker が `pending` ジョブと定時 cron を統合実行** |
| Q2 | 連続失敗判定 state | **A. `mail_worker_runs` テーブル新設（id, started_at, finished_at, summary jsonb, error text, kind('cron'\|'manual')）。直近 N 件で連続失敗判定（issue #16 のスコープ追加）** |
| Q3 | 連続失敗判定対象 | **A. IMAP / AI 独立 2 系統（`mail_worker_runs.summary` に `imap_error: bool`, `ai_failed_count: int` を持たせる）** |
| Q4 | LINE 通知集約 | **A. 上位 5 件まで件名列挙、超過分は「他 M 件」と省略** |
| Q5 | 手動取り込み since UI | **A. プリセット（過去 24h / 3 日 / 7 日 / 任意日付）、デフォルト「過去 7 日」** |
| Q6 | `seed-system-channel.ts` 引数 | **A. `--channel-id=... --secret=... --token=... --bot-id=... --notification-line-user-id=...` 引数指定 + `.env` fallback** |
| Q7 | `@line/bot-sdk` バージョン | **`^11.0.0` を pin**（`npm view @line/bot-sdk version` 確認結果: 11.0.0） |
| Q8 | マイグレーション番号 | **0010**（並行 PR なし、`packages/shared/drizzle/0009_nappy_kat_farrell.sql` の次） |

## 既存資産（PR1-PR4 で揃っているもの）

- `apps/mail-worker/src/pipeline.ts` — IMAP fetch → parse → classify → persist の cron 1 サイクル本体
- `apps/mail-worker/src/index.ts` — エントリポイント、`--once` `--since` `--mock-imap` `--mock-llm` 既存
- `apps/mail-worker/src/cli-args.ts` — `parseSinceArg` 既存（JST round-trip 対応済み、PR3 r3 で硬化）
- `apps/mail-worker/src/classify/classifier.ts` — `classifyMail` + `persistOutcome` 純粋関数化済み
- `apps/mail-worker/src/db.ts` — Drizzle Pool（既存）
- `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `requireAdminSession()`、Server Action パターン（PR4 で確立）
- `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` — 一覧画面、`<Suspense>` + Drawer / Modal の実装パターン
- `users` テーブル（`packages/shared/src/schema/auth.ts`）— `line_login_id`, `display_name` まで存在、`line_channel_id` / `notification_line_user_id` は未追加
- 全パッケージ test pattern（vitest + test DB + `mockAuthModule`）

## 実装フェーズ

### Phase 0: Worktree + branch
- main から `feat/mail-tournament-import-pr5` を切る
- worktree を `C:/tmp/impl-mail-pr5` に作成（Windows long-path 配慮で `C:/tmp/` 直下）
- `corepack pnpm install` で全 package 解決
- `npm view @line/bot-sdk version` 確認済み: `11.0.0`
- migration 番号 0010 を予約

### Phase 1: スキーマ追加（line_channels + users 拡張 + mail_worker_runs + mail_worker_jobs）

#### 1a. enum 追加
`packages/shared/src/schema/enums.ts`:
```ts
export const lineChannelStatusEnum = pgEnum('line_channel_status', [
  'available', 'assigned', 'active', 'system', 'disabled',
])

// PR5 (mail-tournament-import)
export const mailWorkerRunKindEnum = pgEnum('mail_worker_run_kind', ['cron', 'manual'])
export const mailWorkerRunStatusEnum = pgEnum('mail_worker_run_status', [
  'running', 'success', 'imap_failed', 'ai_failed', 'partial',
])
export const mailWorkerJobStatusEnum = pgEnum('mail_worker_job_status', [
  'pending', 'claimed', 'done', 'failed',
])
```

#### 1b. `packages/shared/src/schema/line-channels.ts` 新規
- `id pk`, `channel_id text unique not null`, `channel_secret text not null`, `channel_access_token text not null`, `bot_id text not null`, `status lineChannelStatusEnum not null default 'available'`, `assigned_user_id integer fk → users.id nullable`, `notification_line_user_id text nullable`, `note text nullable`, `created_at`, `updated_at`

#### 1c. `packages/shared/src/schema/auth.ts` 拡張
- `users` に `line_channel_id integer fk → line_channels.id nullable`, `notification_line_user_id text nullable` を追加

#### 1d. `packages/shared/src/schema/mail-worker.ts` 新規
- `mail_worker_runs`:
  - `id pk`, `started_at timestamp tz not null`, `finished_at timestamp tz nullable`, `kind mailWorkerRunKindEnum not null`, `status mailWorkerRunStatusEnum not null default 'running'`, `summary jsonb nullable`, `error text nullable`, `triggered_by_user_id integer fk → users.id nullable`, `since timestamp tz nullable`
- `mail_worker_jobs`:
  - `id pk`, `requested_at timestamp tz not null default now()`, `requested_by_user_id integer fk → users.id not null`, `since timestamp tz nullable`, `status mailWorkerJobStatusEnum not null default 'pending'`, `claimed_at timestamp tz nullable`, `run_id integer fk → mail_worker_runs.id nullable`, `error text nullable`, idx on `(status, requested_at)` for dispatcher poll

#### 1e. `relations.ts` 更新
- users ↔ line_channels（assigned_user 1:1, notification は単純 fk）
- mail_worker_jobs → mail_worker_runs（FK）
- mail_worker_runs → users (triggered_by)

#### 1f. migration 生成
- `corepack pnpm --filter @kagetra/shared db:generate` → `0010_<auto>.sql` 確認
- `0010_*.sql` がカラム追加 11+ 個（line_channels 9, users 2, mail_worker_runs 9, mail_worker_jobs 7）+ enum 3 + idx 1 になることを目視確認
- check-types pass

### Phase 2: notify 層（LINE Bot SDK ラッパー + テンプレート）

#### 2a. `apps/mail-worker/package.json`
- `@line/bot-sdk: ^11.0.0` 追加（`npm view` 確認済み）
- `corepack pnpm install`

#### 2b. `apps/mail-worker/src/notify/line.ts` 新規
- `getSystemChannel(db)`: `line_channels` から `status='system'` LIMIT 1（複数あれば最新）
- `pushSystemNotification(db, message: string)`:
  - getSystemChannel → token 取得 → `MessagingApiClient` で push
  - `notification_line_user_id` を `to` に
  - SDK エラーは catch して log + 例外 throw（pipeline 側で再 raise）
  - test 向け: `LINE_NOTIFY_DRY_RUN=1` で実 push を skip し log のみ
- `LineNotifyError` を export（pipeline 側 catch 用）

#### 2c. `apps/mail-worker/src/notify/message-templates.ts` 新規
- `buildNewDraftsMessage({ drafts: { subject: string }[] }) → string`
  - 上位 5 件題名列挙、超過は「他 M 件」（Q4）
  - 改行: `\n`
  - 末尾に `→ /admin/mail-inbox` 付与
- `buildErrorMessage({ kind: 'imap'|'ai', recentRuns: number, lastError: string }) → string`
  - kind 別文言（IMAP: 「メール取り込みが連続 N 回 IMAP エラーで失敗」/ AI: 「AI 抽出が連続 N 件失敗」）
  - lastError は最大 200 文字に切り詰め

#### 2d. `apps/mail-worker/test/notify/line.test.ts` 新規
- vi.mock で `@line/bot-sdk` の `MessagingApiClient` をモック化
- `pushSystemNotification` 呼び出しで client.pushMessage が `to`/`messages` 引数で呼ばれること検証
- `getSystemChannel` が `status='system'` 行を返す test DB 経由のテスト
- テンプレート: `buildNewDraftsMessage` の 5 件 / 6 件分岐、`buildErrorMessage` の kind 別出力

### Phase 3: pipeline 統合（mail_worker_runs 永続化 + 通知 hookup）

#### 3a. `apps/mail-worker/src/pipeline.ts` 改修
- 既存 `runOnce({ since, llm, mailbox })` を `runOnce({ since, llm, mailbox, kind, triggeredByUserId })` に拡張
- 開始時に `mail_worker_runs` INSERT (`status='running'`)
- 完了時に UPDATE (`finished_at`, `status`, `summary`, `error`)
- summary jsonb shape:
  ```ts
  { fetched: number, classified: number, drafts_created: number, ai_failed: number, imap_error: boolean, errors: string[] }
  ```
- 通知判定（同じ pipeline の末尾、`mail_worker_runs` 永続化の後）:
  - 新規 draft が 1 件以上 → `pushSystemNotification(buildNewDraftsMessage(...))`
  - **連続失敗判定** (`evaluateConsecutiveFailures(db, runId)`):
    - 直近 3 件 `mail_worker_runs` を `started_at desc` で取得
    - 全件 `status IN ('imap_failed', 'partial')` かつ `summary.imap_error=true` → IMAP 異常通知
    - 全件 `summary.ai_failed > 0` 累積 ≥ 3 → AI 異常通知
    - 通知済みフラグ: 直近 1 件目に `summary.notified_imap_alert=true` を持たせて重複通知抑制（連続が解消するまで再送しない）

#### 3b. `apps/mail-worker/src/jobs.ts` 新規（dispatcher）
- `claimNextJob(db) → Job | null`:
  - `UPDATE mail_worker_jobs SET status='claimed', claimed_at=now() WHERE id = (SELECT id FROM mail_worker_jobs WHERE status='pending' ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`
  - SKIP LOCKED で並行実行 safe
- `markJobDone(db, jobId, runId)` / `markJobFailed(db, jobId, error)`

#### 3c. `apps/mail-worker/src/index.ts` 改修
- 起動時のフロー:
  1. `claimNextJob` を 1 回試す → ヒットすれば `kind='manual'`, `since=job.since`, `triggeredByUserId=job.requestedByUserId` で runOnce
  2. ヒットしなければ `kind='cron'`, `since=defaultSinceForCron()` で runOnce
  3. job がある場合は run 完了後に `markJobDone(jobId, runId)`
- `--once` フラグは既存通り維持（dev でジョブ無しでも cron 1 回相当を回せる）
- `--no-claim` フラグ追加（job 無視で純 cron 動作 = 既存挙動の復元、test/debug 用）

#### 3d. test (`apps/mail-worker/test/pipeline-runs.test.ts` 新規)
- `runOnce` が `mail_worker_runs` を `running` → `success` 遷移させる
- 失敗時に `imap_failed` / `ai_failed` / `partial` に分岐
- 連続 3 件失敗で `evaluateConsecutiveFailures` が `pushSystemNotification` を呼ぶ
- 復旧後は `notified_imap_alert` フラグで再通知が抑制される
- ジョブ claim → run → markDone のハッピーパス

### Phase 4: web 側 Server Action + UI

#### 4a. `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` に追加
- `triggerMailFetch(formData) → { jobId: number }`:
  1. `requireAdminSession()`
  2. `since` を form から読み取り（プリセット → ms 換算 / 任意日付 → JST 0:00）
  3. `mail_worker_jobs` INSERT（`requested_by_user_id = session.user.id`, `since`, `status='pending'`）
  4. `revalidatePath('/admin/mail-inbox')`
  5. 戻り値: `{ jobId }`（フロントは toast + 「ジョブ予約済み」表示、ポーリングは v1 では実装しない）

#### 4b. `apps/web/src/app/(app)/admin/mail-inbox/components/TriggerFetchButton.tsx` 新規
- ボタン押下 → ダイアログ open
- ダイアログ内:
  - ラジオ: 「過去 24 時間」/「過去 3 日」/「過去 7 日」（デフォルト）/「任意日付」
  - 「任意日付」選択時: `<input type="date">` を有効化、値を JST 0:00 に
  - 「実行」ボタンで `triggerMailFetch` 呼び出し
- 成功時 toast「ジョブ #N を予約しました。次回 cron 実行 (~30 分以内) で処理されます」
- shadcn Dialog + RadioGroup 使用

#### 4c. `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` 改修
- ヘッダー右上に `<TriggerFetchButton />` 配置
- 既存 draft 一覧テーブルの上に「最近の取り込み履歴」セクション追加（`mail_worker_runs` 直近 5 件、kind / status / drafts_created / started_at の簡易表示）
  - 失敗時は赤アイコン + error 文の hover tooltip

#### 4d. `apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts` 拡張
- `triggerMailFetch`:
  - 認可 (admin/vice_admin OK / member NG)
  - 各プリセットで `since` が正しく計算される（過去 24h / 3 日 / 7 日 / 任意日付）
  - `mail_worker_jobs` に INSERT され `status='pending'`

#### 4e. `apps/web/e2e/admin-mail-inbox-trigger.spec.ts` 新規
- admin login → /admin/mail-inbox → 「メール取り込み」ボタン → ダイアログ → プリセット選択 → 実行 → toast 表示
- 「最近の取り込み履歴」セクションが表示される（seed で 1 行入れる）

### Phase 5: systemd unit + デプロイ手順書

#### 5a. `apps/mail-worker/systemd/kagetra-mail-worker.service` 新規
```ini
[Unit]
Description=Kagetra mail-worker (cron + job dispatcher)
After=network.target

[Service]
Type=oneshot
User=kagetra
WorkingDirectory=/opt/kagetra
EnvironmentFile=/opt/kagetra/.env.production
ExecStart=/usr/bin/corepack pnpm --filter @kagetra/mail-worker exec node dist/index.js
StandardOutput=journal
StandardError=journal
```

#### 5b. `apps/mail-worker/systemd/kagetra-mail-worker.timer` 新規
```ini
[Unit]
Description=Run kagetra mail-worker every 30 minutes
Requires=kagetra-mail-worker.service

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
```

#### 5c. `apps/mail-worker/scripts/seed-system-channel.ts` 新規
- 引数 parser:
  - `--channel-id`, `--channel-secret`, `--access-token`, `--bot-id`, `--notification-line-user-id` (Q6)
  - 全部 env (`LINE_SYSTEM_CHANNEL_*`) fallback
  - 必須欠如時 throw（exit 1）
- 既存 `status='system'` 行があれば UPDATE（access_token rotation 用途）、無ければ INSERT
- dry-run フラグで実行内容のみ print

#### 5d. `docs/deploy/mail-worker.md` 新規
- 章立て:
  1. 前提（Lightsail スペック, Node version, pnpm version, PostgreSQL 接続情報）
  2. 初回デプロイ
     - `git clone` / `corepack pnpm install` / `pnpm --filter ... build`
     - `cp apps/mail-worker/systemd/*.service /etc/systemd/system/`（要 root）
     - `systemctl daemon-reload && systemctl enable --now kagetra-mail-worker.timer`
  3. LINE Bot 初期登録
     - LINE Developers Console で Messaging API channel 作成
     - 管理者が Bot を友だち追加 → webhook 経由で `userId` を取得（手段は別途）
     - `pnpm tsx apps/mail-worker/scripts/seed-system-channel.ts --channel-id=... ...` 実行
  4. 環境変数（`/opt/kagetra/.env.production` に置くもの）
  5. 動作確認
     - `journalctl -u kagetra-mail-worker.service -n 50`
     - `/admin/mail-inbox` の最近の取り込み履歴で run が記録されているか
  6. トラブルシュート（IMAP 認証失敗 / LINE 401 / DB 接続切れ）
  7. アクセストークン rotation 手順（`seed-system-channel.ts` を再実行）

### Phase 6: smoke test + 最終 QA

- **mail-worker smoke**:
  - `corepack pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --once --no-claim --mock-imap --mock-llm`
  - exit 0、`mail_worker_runs` が 1 行作られ `status='success'`、新規 draft 数が log に出る
- **手動取り込み smoke** (job dispatcher 経路):
  - test DB に `mail_worker_jobs` を 1 行 INSERT
  - `corepack pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --once --mock-imap --mock-llm`
  - jobs.status='done'、runs.kind='manual', triggered_by_user_id 一致
- **連続失敗 smoke**:
  - test DB で `mail_worker_runs` を 3 件「imap_failed」で seed → 4 件目を mock IMAP 失敗で実行
  - notify モックが called、4 件目の summary に `notified_imap_alert=true`
- **`pnpm --filter @kagetra/web check-types` ✅**
- **`pnpm --filter @kagetra/mail-worker check-types` ✅**
- **`pnpm --filter @kagetra/shared db:check` ✅**
- **`pnpm --filter @kagetra/web test` ✅**
- **`pnpm --filter @kagetra/mail-worker test` ✅**
- **`pnpm --filter @kagetra/web exec playwright test admin-mail-inbox-trigger` ✅**
- ESLint clean
- gh pr create with description (Closes #16, link to #11 / #20)

## DoD (Issue #16 + grill 拡張)

- [ ] `line_channels` / `mail_worker_runs` / `mail_worker_jobs` テーブルが migration 0010 で作成される
- [ ] `users` に `line_channel_id` / `notification_line_user_id` 追加（既存挙動非破壊）
- [ ] `pnpm tsx apps/mail-worker/scripts/seed-system-channel.ts --channel-id=... ...` で system 行 INSERT/UPDATE
- [ ] mail-worker pipeline 末尾で LINE 通知が送信される（モック SDK で push 引数検証）
- [ ] IMAP 連続 3 回失敗 / AI 連続 3 回失敗で異常時 LINE 通知（モック SDK で）
- [ ] 復旧後の重複通知が `notified_imap_alert` で抑制される
- [ ] `/admin/mail-inbox` の「メール取り込み」ボタン → ダイアログ → プリセット選択 → ジョブ予約
- [ ] 「最近の取り込み履歴」セクションが直近 5 件の `mail_worker_runs` を表示
- [ ] systemd service / timer 設定例ファイルが `apps/mail-worker/systemd/` に存在
- [ ] `docs/deploy/mail-worker.md` にデプロイ手順 + LINE channel 初期登録 + rotation 手順
- [ ] `pnpm tsx apps/mail-worker/src/index.ts --once --no-claim --mock-imap --mock-llm` smoke 成功
- [ ] vitest で notify レイヤ + jobs dispatcher + runs 永続化の unit test が PASS
- [ ] check-types / lint / vitest / E2E が CI 通過

## スコープ外（明記）

- LINE Login の `notification_line_user_id` 自動取得 webhook → 別 PR（Phase P3-A 後）
- 100 channel プールの自動割当ロジック → P2 想定
- AI 信頼度による自動承認 → v1 では採用しない（要件 §6.7 既決）
- mail-worker のメトリクス可視化（Grafana 等）→ v1 では journalctl のみ
- 異常時の SMS / メール fallback 通知 → 不要（LINE 単独）
- ジョブ予約画面の進捗ポーリング UI → v1 では予約完了 toast のみ。次回 cron 実行 (~30 分以内) で処理される旨を表示

## 想定外注意点（事前に明文化）

- **dispatcher 競合**: systemd timer の `Type=oneshot` で多重起動はないが、手動の `systemctl start` を timer 動作中に叩くと重なる可能性あり。`mail_worker_jobs` の `FOR UPDATE SKIP LOCKED` で claim 競合は防げる。run の重複は許容（同じ since で 2 run 走っても draft の `UNIQUE(message_id)` で重複 INSERT は弾かれる）
- **JST round-trip**: PR3 r3 の `parseSinceArg` 同様、Server Action 側 since も JST で渡す。プリセット「過去 24 時間」は `Date.now() - 24*3600*1000` の Date オブジェクト直渡しで OK（DB は timestamp tz）
- **LINE SDK エラー**: 401 (token invalid) は通知失敗を log のみ（pipeline は continue）、500 系は再試行なし（次回 cron で再判定）
- **連続失敗判定の境界**: `mail_worker_runs` 0 件状態（初回起動）では通知判定 skip
- **SKIP LOCKED + integer FK**: `mail_worker_runs.id` を `mail_worker_jobs.run_id` に紐付ける際、claim 後に runs INSERT → jobs UPDATE の順で OK（claim 自体は run_id null）
