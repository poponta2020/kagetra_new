---
status: completed
---
# mail-inbox-mailer 実装手順書

## 実装タスク

### タスク1: DB スキーマ変更 + migration
- [x] 完了
- **概要:** linked_event_id、tournament_drafts.status='ai_processing'、mail_worker_jobs.kind/payload、mail_triage_status から deferred 削除を含む drizzle スキーマ更新と migration ファイル作成。既存 deferred mails の unprocessed 化も含む
- **変更対象ファイル:**
  - `packages/shared/src/schema/mail-messages.ts` — `linkedEventId` カラム追加（FK to events.id, ON DELETE SET NULL）+ index
  - `packages/shared/src/schema/tournament-drafts.ts` — 既存維持（enum 変更は enums.ts 側）
  - `packages/shared/src/schema/mail-worker.ts` — `mailWorkerJobs` に `kind`, `payload` カラム追加
  - `packages/shared/src/schema/enums.ts` — `tournamentDraftStatusEnum` に `'ai_processing'` 追加、`mailTriageStatusEnum` から `'deferred'` 削除、`mailWorkerJobKindEnum` 新規（'fetch' | 'manual_extract'）
  - `packages/shared/drizzle/0022_mail_inbox_mailer.sql` — 新規生成 migration
- **依存タスク:** なし
- **対応Issue:** #120
- **完了条件:**
  - `pnpm --filter @kagetra/shared db:generate` で 0022 migration が生成される
  - 既存 deferred 行を unprocessed に倒す UPDATE 句が migration に含まれる
  - `pnpm --filter @kagetra/shared db:migrate` でテスト DB に適用できる
  - `pnpm typecheck` 通過

### タスク2: mail-worker の cron AI 廃止 + manual_extract dispatcher
- [x] 完了
- **概要:** cron 動作（kind='fetch'）では llmExtractor を渡さない運用に変更し、manual_extract ジョブを処理する dispatcher 分岐を追加。CLI に `--mode=extract-only` フラグも追加
- **変更対象ファイル:**
  - `apps/mail-worker/src/pipeline.ts` — `RunPipelineOptions.llmExtractor` を呼び出し側で制御
  - `apps/mail-worker/src/jobs.ts` — dispatcher に kind 分岐追加。`manual_extract` 時は `payload.mail_message_id` から mail 取得 → `classifyMail` + `persistOutcome` 呼び出し
  - `apps/mail-worker/src/index.ts` — CLI に `--mode=extract-only` フラグ追加。extract-only は IMAP fetch をスキップ
  - `apps/mail-worker/test/pipeline.test.ts` — cron 動作変更分のテスト修正
  - `apps/mail-worker/test/jobs.test.ts` — dispatcher kind 分岐の新テスト追加
- **依存タスク:** タスク1 (#120)
- **対応Issue:** #121
- **完了条件:**
  - `pnpm --filter @kagetra/mail-worker test --no-file-parallelism` で全テスト pass
  - `pnpm --filter @kagetra/mail-worker start --mode=extract-only` で manual_extract ジョブだけを処理することを確認
  - cron 既定で AI 抽出が動かない（mock test）

### タスク3: Server Actions の追加・修正
- [x] 完了
- **概要:** 新規 `triggerExtractDraft` / `linkMailToEvent` / `unlinkMailFromEvent` を追加。既存 `undoTriage` から deferred 経路を削除
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — 上記 3 アクション追加 + undoTriage 修正
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts` — 新規アクションのテスト追加
- **依存タスク:** タスク1 (#120), タスク2 (#121)
- **対応Issue:** #122
- **完了条件:**
  - 3 アクションのテストが全 pass（正常系、認可エラー、race condition）
  - linkMailToEvent が broadcastMailToEvent を after() で起動することを確認
  - linked_event_id 更新と triage_status='processed' が同一 tx 内

### タスク4: mail-inbox UI 改修（一覧 + 詳細 + polling）
- [ ] 完了
- **概要:** 一覧画面の noise/deferred フィルタ削除、詳細画面の本文即時表示・3 ボタンアクション・AI 抽出中カード・polling 接続。新規コンポーネント 5 つを追加
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` — noise/deferred フィルタ削除
  - `apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx` — 本文即時表示、draft 状態分岐、3 ボタン
  - `apps/web/src/app/api/admin/mail-inbox/[id]/draft-status/route.ts` — 新規 polling 用 GET エンドポイント
  - `apps/web/src/app/(app)/admin/mail-inbox/components/AIExtractConfirmDialog.tsx` — 新規確認ダイアログ
  - `apps/web/src/app/(app)/admin/mail-inbox/components/ExtractionInProgressCard.tsx` — 新規 spinner + polling
  - `apps/web/src/app/(app)/admin/mail-inbox/components/ExistingEventLinkSheet.tsx` — 新規イベント選択シート（未開催 + 過去 30 日 + 検索）
  - `apps/web/src/app/(app)/admin/mail-inbox/components/MailDetailActions.tsx` — 新規 3 ボタンエリア
  - `apps/web/src/app/(app)/admin/mail-inbox/components/UndoTriageButton.tsx` — 新規 undo ボタン
- **依存タスク:** タスク3 (#122)
- **対応Issue:** #123
- **完了条件:**
  - dev server で全フロー（AI 抽出/結びつけ/対応不要/undo）が動く
  - polling が 3 秒間隔で draft.status を fetch し、変化したら router.refresh()
  - スマホ実機（iPhone PWA）で UI 確認

### タスク5: events 詳細「関連メール」セクション
- [ ] 完了
- **概要:** events 詳細ページに「関連メール」セクションを追加。3 経路 UNION で紐付いた mail を抽出して受信日降順表示
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/[id]/page.tsx` — 関連メールセクション追加
  - `apps/web/src/app/(app)/events/[id]/components/EventRelatedMails.tsx` — 新規セクションコンポーネント
- **依存タスク:** タスク3 (#122)
- **対応Issue:** #124
- **完了条件:**
  - 既存イベント結びつけ（linked_event_id）経由のメールが表示される
  - AI 抽出 → 承認経由のメール（events.tournament_draft_id）も表示される
  - 訂正版 linkDraftToEvent 経由（tournament_drafts.event_id）も表示される
  - 受信日降順、クリックで mail 詳細に遷移

### タスク6: systemd timer + 運用設定
- [ ] 完了
- **概要:** 30 秒間隔の manual_extract 専用 systemd timer を追加。本番デプロイ手順に組み込む
- **変更対象ファイル:**
  - `infra/systemd/kagetra-mail-worker-extract.service` — 新規 unit file
  - `infra/systemd/kagetra-mail-worker-extract.timer` — 新規 timer file
  - `infra/scripts/setup-systemd.sh`（既存があれば）— 新 timer の enable/start 追加
  - `.github/workflows/auto-deploy.yml` — deploy 時の timer reload を追加（必要なら）
- **依存タスク:** タスク2 (#121)
- **対応Issue:** #125
- **完了条件:**
  - 本番環境で `kagetra-mail-worker-extract.timer` が動作
  - manual_extract ジョブが 30 秒以内に拾われる
  - 既存 fetch timer は 30 分のまま、AI を呼ばない設定が反映されている

### タスク7: E2E テスト + 既存テスト修正 + DoD
- [ ] 完了
- **概要:** AI 抽出→承認→LINE 配信の通し E2E、既存イベント結びつけ→LINE 配信の E2E、その他既存テストの修正。DoD チェックリスト消化
- **変更対象ファイル:**
  - `apps/web/test/e2e/mail-inbox-ai-extract.spec.ts` — 新規 E2E
  - `apps/web/test/e2e/mail-inbox-link-event.spec.ts` — 新規 E2E
  - 既存テストファイル — type error 修正
- **依存タスク:** タスク1〜6 (#120〜#125)
- **対応Issue:** #126
- **完了条件:**
  - 全 E2E pass（CI green）
  - 既存テスト全 pass
  - `/dod` でチェックリスト全項目クリア
  - 本番デプロイ後、スマホ実機で AI 抽出→承認→LINE 受信を確認
  - 本番デプロイ後、既存イベント結びつけ→LINE 受信を確認

## 実装順序

```
タスク1 (#120, DB)
    ↓
タスク2 (#121, mail-worker) ──→ タスク6 (#125, systemd)
    ↓
タスク3 (#122, Server Actions)
    ├──→ タスク4 (#123, mail-inbox UI)
    └──→ タスク5 (#124, events 関連メール)
                            ↓
                        タスク7 (#126, E2E + DoD)
```

1. **タスク1** (#120): DB スキーマ変更 + migration（前提）
2. **タスク2** (#121): mail-worker の cron AI 廃止 + manual_extract dispatcher
3. **タスク3** (#122): Server Actions
4. **タスク4, 5** (#123, #124): UI（並行可能、タスク3完了後）
5. **タスク6** (#125): systemd timer（タスク2完了後でも可）
6. **タスク7** (#126): E2E + 既存テスト修正 + DoD（最後）
