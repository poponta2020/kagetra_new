---
status: completed
---

# mail-tournament-import 実装手順書

## 全体方針

CLAUDE.md ルール 3「1PR=1機能」に従い、5 PR に分割。各 PR は単独でレビュー・マージ可能、CI 通過 + DoD 充足を必須条件とする。

スキーマ変更は機能発生地点の PR で個別に実施（5 つの migration）。これにより各 PR の差分が最小化され、ロールバックも局所的に可能。

依存関係:
```
PR1 ──→ PR2 ──→ PR3 ──→ PR4
              └─────→ PR5
```
- PR2 は PR1（mail_messages）に依存
- PR3 は PR2（mail_attachments の extracted_text）に依存
- PR4 は PR3（tournament_drafts）に依存
- PR5 は PR3（drafts への通知）と PR1（cron 起動の全体パイプライン）に依存

---

## 実装タスク

### タスク1: PR1 — IMAP fetcher + mail_messages + メール一覧基盤

- [x] 完了
- **概要**: `apps/mail-worker` パッケージ新設、imapflow で Yahoo!IMAP 接続、Inbox からメール取得、ヘッダーフィルタ後 `mail_messages` に永続化。`/admin/mail-inbox` で取り込み済みメール一覧を表示（添付・AI・承認なし）。
- **変更対象ファイル**:
  - `packages/shared/src/schema/enums.ts` — `mailMessageStatusEnum`, `mailClassificationEnum` 追加
  - `packages/shared/src/schema/mail-messages.ts` — 新規
  - `packages/shared/src/schema/relations.ts` — mail_messages 関連を追加
  - `packages/shared/src/schema/index.ts` — re-export
  - `packages/shared/migrations/<n>_mail_messages.sql` — Drizzle migration
  - `apps/mail-worker/package.json` — 新規（依存: drizzle-orm, imapflow, dotenv 等）
  - `apps/mail-worker/tsconfig.json` — 新規
  - `apps/mail-worker/vitest.config.ts` — 新規
  - `apps/mail-worker/src/index.ts` — エントリポイント (--once / --since / --dry-run)
  - `apps/mail-worker/src/config.ts` — env 読み込み + zod validate
  - `apps/mail-worker/src/db.ts` — drizzle 接続
  - `apps/mail-worker/src/fetch/imap-client.ts` — imapflow ラッパー
  - `apps/mail-worker/src/fetch/fetcher.ts` — 新着取得 + de-dup
  - `apps/mail-worker/src/fetch/pre-filter.ts` — ヘッダーフィルタ
  - `apps/mail-worker/src/persist/mail-message.ts` — CRUD
  - `apps/mail-worker/src/pipeline.ts` — fetch → persist の最小フロー
  - `apps/mail-worker/test/fixtures/*.eml` — フィクスチャ（最低 3 件: 大会案内 / メルマガ / 個人通知）
  - `apps/mail-worker/test/fetch/*.test.ts` — fetcher / pre-filter のテスト
  - `apps/mail-worker/test/pipeline.test.ts` — fixture 再生 → DB 書き込み確認
  - `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` — 一覧画面（受信日・件名・送信者・status 表示のみ）
  - `apps/web/src/auth.ts` または middleware — `/admin/mail-inbox` の admin/vice_admin ガード
  - `apps/web/src/components/layout/` — admin ナビに「メール受信箱」追加（admin のみ表示）
  - `turbo.json` — apps/mail-worker をビルド・テスト・lint パイプラインに含める
  - `.github/workflows/ci.yml` — 必要なら mail-worker 側の test も実行
  - `docker/docker-compose.yml` — 必要なら mail-worker をローカル開発用に
- **依存タスク**: なし
- **対応 Issue**: #12 (親 #11)
- **完了条件 (DoD)**:
  - `pnpm tsx apps/mail-worker/src/index.ts --once --mock-imap` で fixture から 3 件 fetch & DB INSERT が成立
  - 同じ Message-ID で 2 回実行しても重複 INSERT されない
  - List-Unsubscribe ヘッダー付きフィクスチャは `mail_messages.classification='noise'` または skip
  - `/admin/mail-inbox` に admin でアクセス → 取り込んだ 3 件が時系列降順に表示
  - 一般会員でアクセス → 403 / リダイレクト
  - vitest で fetcher / pre-filter / pipeline の単体・統合テストが PASS
  - check-types / lint / vitest / E2E のすべてが CI で通過

---

### タスク2: PR2 — 添付テキスト化 + 添付保存

- [ ] 完了
- **概要**: `mail_attachments` テーブル追加、PDF/DOCX/XLSX のテキスト抽出 + bytea 保存、`/api/admin/mail/attachments/[id]` 添付配信 API、`/admin/mail-inbox` に添付ファイル一覧表示。
- **変更対象ファイル**:
  - `packages/shared/src/schema/enums.ts` — `attachmentExtractionStatusEnum` 追加
  - `packages/shared/src/schema/mail-attachments.ts` — 新規
  - `packages/shared/src/schema/relations.ts` — mail_attachments 関連を追加
  - `packages/shared/src/schema/index.ts` — re-export
  - `packages/shared/migrations/<n>_mail_attachments.sql` — Drizzle migration
  - `apps/mail-worker/package.json` — `pdfjs-dist`, `mammoth`, `xlsx` を依存追加
  - `apps/mail-worker/src/extract/pdf.ts` — pdfjs-dist で PDF→テキスト
  - `apps/mail-worker/src/extract/docx.ts` — mammoth で DOCX→テキスト
  - `apps/mail-worker/src/extract/xlsx.ts` — xlsx で XLSX→テキスト
  - `apps/mail-worker/src/extract/orchestrator.ts` — content-type で分岐
  - `apps/mail-worker/src/persist/attachment.ts` — CRUD（bytea + extracted_text）
  - `apps/mail-worker/src/pipeline.ts` — fetch → persist mail → 添付保存 + テキスト抽出 まで拡張
  - `apps/mail-worker/test/fixtures/*.pdf` `*.docx` `*.xlsx` — 抽出テスト用フィクスチャ
  - `apps/mail-worker/test/extract/*.test.ts` — 各 extractor の unit test
  - `apps/web/src/app/api/admin/mail/attachments/[id]/route.ts` — 添付配信 API（admin auth + Content-Type 付き bytea 返却）
  - `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` — 添付ファイル一覧表示追加（リンクで配信 API へ）
  - `apps/web/src/app/(app)/admin/mail-inbox/components/AttachmentList.tsx` — 新規
- **依存タスク**: タスク 1
- **対応 Issue**: #13 (親 #11)
- **完了条件 (DoD)**:
  - 大会要項 PDF / DOCX / XLSX 各 1 件のフィクスチャを fixture として、`extracted_text` が `null` でなく抽出される
  - 破損ファイル fixture を入れた場合 `extraction_status='failed'`, `extracted_text=null` になる、エラーで pipeline 全体は停止しない
  - `mail_attachments.data` (bytea) に原本バイナリが保存される
  - `/api/admin/mail/attachments/<id>` にアクセスして PDF が表示できる（admin 必須）
  - 一般会員 / 未認証で同 URL → 403
  - 一覧画面に添付ファイルアイコン + ファイル名が表示される
  - vitest で各 extractor の unit test が PASS
  - check-types / lint / vitest / E2E のすべてが CI で通過

---

### タスク3: PR3 — AI 抽出 + tournament_drafts 作成

- [ ] 完了
- **概要**: Anthropic Sonnet 4.6 で大会案内判定 + 構造化抽出、`tournament_drafts` に永続化。Zod スキーマで output validate、プロバイダ抽象化レイヤを設計。プロンプトキャッシュを有効化。`/admin/mail-inbox` 一覧の各メール行に大会名・信頼度バッジ・status pill を追加。
- **変更対象ファイル**:
  - `packages/shared/src/schema/enums.ts` — `tournamentDraftStatusEnum` 追加
  - `packages/shared/src/schema/tournament-drafts.ts` — 新規（`UNIQUE(message_id)` + index `(status, created_at DESC)`）
  - `packages/shared/src/schema/relations.ts` — `mailMessages` ↔ `tournamentDrafts` (1:0..1) を追加
  - `packages/shared/src/schema/index.ts` — re-export
  - `packages/shared/migrations/0008_<auto>.sql` — Drizzle migration（enum + table + indices + 自己 FK）
  - `apps/mail-worker/package.json` — `@anthropic-ai/sdk`, `zod-to-json-schema` を依存追加
  - `apps/mail-worker/src/classify/llm/types.ts` — `LLMExtractor` interface
  - `apps/mail-worker/src/classify/llm/anthropic.ts` — `AnthropicSonnet46Extractor`（tool use 強制 + cache_control 1h + PDF native document block）
  - `apps/mail-worker/src/classify/llm/fixture.ts` — `FixtureLLMExtractor` (`--mock-llm` と test 共通、subject ベース Map lookup)
  - `apps/mail-worker/src/classify/llm/index.ts` — provider factory（`createLLMExtractor()` が env / DI で実装選択）
  - `apps/mail-worker/src/classify/schema.ts` — Zod schema (`ExtractionPayloadSchema`)
  - `apps/mail-worker/src/classify/prompt.ts` — system prompt + few-shot 例 + `PROMPT_VERSION = '1.0.0'`
  - `apps/mail-worker/src/classify/classifier.ts` — `classifyMail(messageId, opts)` を export（pipeline と Server Action 双方から呼べる、retry 1 回）
  - `apps/mail-worker/src/classify/cost.ts` — token → USD 換算（Sonnet 4.6 価格 hardcoded）
  - `apps/mail-worker/src/persist/draft.ts` — tournament_drafts upsert（`ON CONFLICT (message_id) DO UPDATE`）
  - `apps/mail-worker/src/pipeline.ts` — pipeline に AI フェーズ統合（mail+attachments txn → AI → draft 別 txn、noise はスキップ、direct loop で順次処理）
  - `apps/mail-worker/src/index.ts` — `--mock-llm` CLI flag 追加
  - `apps/mail-worker/src/reextract.ts` — CLI batch 再抽出 (`--since=YYYY-MM-DD`)
  - `apps/mail-worker/test/fixtures/llm/*.expected.json` — AI 期待出力 fixture
  - `apps/mail-worker/test/fixtures/correction-tournament.eml` — 訂正版 eml 新規
  - `apps/mail-worker/test/classify/classifier.test.ts` — モック LLM での classifier テスト（陽性 / 陰性 / 訂正版 / Zod 失敗 retry / 再抽出 UPDATE）
  - `apps/mail-worker/test/classify/anthropic.test.ts` — Anthropic SDK 引数 spy（cache_control 検証）
  - `apps/mail-worker/test/pipeline.test.ts` — pipeline 全体（fixture 再生 → drafts まで）
  - `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` — 各メールカードに大会名 / 開催日 / 信頼度バッジ / draft status pill を追加（filter 行は **PR4 へ持ち越し**）
  - `apps/web/src/app/(app)/admin/mail-inbox/components/ConfidenceBadge.tsx` — 新規（`>=0.9` success, `>=0.5` warning, `<0.5` neutral, null は "—"）
  - `apps/web/src/app/(app)/admin/mail-inbox/components/DraftCard.tsx` — 新規（一覧カード内で添付チップの隣に縦積み）
  - `.env.example` — `ANTHROPIC_API_KEY` を追加
  - `docs/features/mail-tournament-import/cache-smoke.md` — prompt cache の手動 smoke test 手順（実機で 2 回叩いて `cache_read_input_tokens > 0` 確認）
- **依存タスク**: タスク 2 (PR2 #13 ship 済 = `e8837b1`)
- **対応 Issue**: #14 (親 #11)
- **完了条件 (DoD)**:
  - 大会案内 fixture を `FixtureLLMExtractor` 経由で AI に通すと `is_tournament_announcement=true`, `confidence>=0.9`, `extracted.title` 等が抽出される
  - メルマガ fixture（pre-filter で noise 化済）は AI 呼び出しを **スキップ**、draft 作成されない（`mail_messages.classification='noise'`）
  - メルマガが pre-filter を通過したケース（false negative）でも、AI が `is_tournament_announcement=false` を返したら draft 作成されない、`mail_messages.classification='noise'` に upgrade
  - 訂正版 fixture を AI に通すと `is_correction=true`, `references_subject` が出力される
  - 同じメールを再 classify した時、`tournament_drafts.extracted_payload` が UPDATE され（`UNIQUE(message_id)` で INSERT は失敗）、`prompt_version` が更新される
  - 壊れた tool_use.input を返す `BrokenLLMExtractor` の場合、retry 1 回 → 失敗で `tournament_drafts.status='ai_failed'`、`ai_raw_response` に raw text が入る
  - `Anthropic SDK` の `messages.create` 呼び出し引数を spy し、`system[].cache_control.type === 'ephemeral'` + `ttl: '1h'` がセットされていることを unit test で確認
  - 実 API の cache hit 確認は手動 smoke（cache-smoke.md 手順）で ship 前に 1 回検証
  - `/admin/mail-inbox` 一覧で大会名・開催日・信頼度バッジ・status が表示される
  - vitest で classifier の単体テストが PASS（モック LLM）
  - check-types / lint / vitest / E2E のすべてが CI で通過

---

### タスク4: PR4 — 承認 UI + events 拡張

- [ ] 完了
- **概要**: events に新規 11 カラム追加、`EventForm` を拡張、`/admin/mail-inbox/[id]` 詳細・承認画面を実装。承認すると events INSERT、却下すると `tournament_drafts.status='rejected'`。訂正版ヒント表示も含む。Playwright で E2E ハッピーパス。
- **変更対象ファイル**:
  - `packages/shared/src/schema/events.ts` — 11 カラム追加（`fee_jpy`, `payment_deadline`, `payment_info`, `payment_method`, `entry_method`, `organizer`, `capacity_a` 〜 `capacity_e`）
  - `packages/shared/migrations/<n>_events_extension.sql` — Drizzle migration
  - `apps/web/src/lib/form-schemas.ts` — `eventFormSchema` を新カラム対応に拡張、`extractEventFormData` も対応
  - `apps/web/src/components/events/event-form.tsx` — 新カラム入力フィールド追加（既存テスト更新）
  - `apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx` — 詳細・承認画面
  - `apps/web/src/app/(app)/admin/mail-inbox/components/ApprovalForm.tsx` — EventForm 再利用 + AI 抽出値で pre-fill
  - `apps/web/src/app/(app)/admin/mail-inbox/components/ExtractedPayloadView.tsx` — AI 抽出 raw 表示（折りたたみ）
  - `apps/web/src/app/(app)/admin/mail-inbox/components/CorrectionHint.tsx` — 訂正版候補表示
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — Server Actions（`approveDraft`, `rejectDraft`, `reextractDraft`, `linkDraftToEvent`）
  - `apps/web/e2e/admin-mail-inbox.spec.ts` — Playwright E2E (seed draft → admin login → approve → events 作成確認)
  - `apps/web/src/test-utils/seed.ts` — `createDraft` factory 追加（fixture 注入用）
- **依存タスク**: タスク 3
- **対応 Issue**: #15 (親 #11)
- **完了条件 (DoD)**:
  - 既存 events / EventForm の振る舞いが回帰しない（既存 vitest + Playwright が通る）
  - 新カラムが空のまま `/events/new` から手動作成できる
  - `/admin/mail-inbox/[id]` で AI 抽出値が pre-fill された ApprovalForm が表示される
  - 「承認」ボタンで events INSERT、`tournament_drafts.status='approved'` & `event_id` 更新
  - 「却下」ボタンで `tournament_drafts.status='rejected'`、events 作成されない
  - 「再 AI 抽出」ボタンで extracted_payload が更新される
  - 訂正版 draft（`is_correction=true`）の詳細画面で、件名類似の既存 draft / events のリンクが表示される
  - 「既存 events に紐付ける」ボタンで `tournament_drafts.event_id` が指定 event を指す
  - Playwright E2E ハッピーパス（draft seed → 承認 → events ページに表示） PASS
  - vitest で EventForm 拡張のスナップショット / フィールド存在テストが PASS
  - check-types / lint / vitest / E2E のすべてが CI で通過

---

### タスク5: PR5 — 定期実行 + LINE 通知 + デプロイ

- [ ] 完了
- **概要**: `line_channels` テーブル新設、users 拡張、`@line/bot-sdk` で LINE Messaging API push 通知、systemd timer 設定例配置、手動取り込みボタン実装。本番デプロイ手順書を docs に追加。
- **変更対象ファイル**:
  - `packages/shared/src/schema/enums.ts` — `lineChannelStatusEnum` 追加
  - `packages/shared/src/schema/line-channels.ts` — 新規
  - `packages/shared/src/schema/auth.ts` — users に `line_channel_id`, `notification_line_user_id` 追加
  - `packages/shared/src/schema/relations.ts` — line_channels 関連を追加
  - `packages/shared/src/schema/index.ts` — re-export
  - `packages/shared/migrations/<n>_line_channels.sql` — Drizzle migration
  - `apps/mail-worker/package.json` — `@line/bot-sdk` を依存追加
  - `apps/mail-worker/src/notify/line.ts` — push wrapper（line_channels から system 用 token を取得）
  - `apps/mail-worker/src/notify/message-templates.ts` — 通知文テンプレート
  - `apps/mail-worker/src/pipeline.ts` — pipeline 末尾で LINE 通知 + 異常時通知の実装
  - `apps/mail-worker/test/notify/line.test.ts` — モック LINE SDK でのテスト
  - `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` — 「メール取り込み」ボタン追加 + since パラメータモーダル
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `triggerMailFetch` Server Action 追加
  - `docs/deploy/mail-worker.md` — Lightsail デプロイ手順 + systemd unit/timer 設定例 + LINE channel 初期登録手順
  - `apps/mail-worker/systemd/kagetra-mail-worker.service` — 設定例ファイル
  - `apps/mail-worker/systemd/kagetra-mail-worker.timer` — 設定例ファイル
  - `apps/mail-worker/scripts/seed-system-channel.ts` — 初期データ投入用 helper（`line_channels` に system 用 1 行を INSERT）
- **依存タスク**: タスク 3（drafts ができてから通知が意味を持つ）, タスク 1（pipeline の cron 起動）
- **対応 Issue**: #16 (親 #11)
- **完了条件 (DoD)**:
  - `line_channels` テーブルが migration で作成される
  - `pnpm tsx apps/mail-worker/scripts/seed-system-channel.ts --channel-id=... --secret=... --token=... --bot-id=...` で system 用 1 行が INSERT できる
  - mail-worker が pipeline 末尾で LINE 通知を送る（モック SDK で push 引数が正しいことを確認）
  - 連続 3 回失敗で異常時 LINE 通知が送信される（モック SDK で）
  - `/admin/mail-inbox` の「メール取り込み」ボタンから since 指定で手動実行ジョブを起動できる（mail-worker への trigger）
  - systemd service / timer の設定例ファイルが apps/mail-worker/systemd/ に置かれている
  - docs/deploy/mail-worker.md にデプロイ手順（Lightsail コピー → systemd 配置 → enable → 動作確認）が書かれている
  - 手動 dry-run smoke test (`pnpm tsx apps/mail-worker/src/index.ts --once --dry-run --mock-imap --mock-llm`) が成功する
  - vitest で notify レイヤの unit test が PASS
  - check-types / lint / vitest / E2E のすべてが CI で通過

---

## 実装順序

1. **タスク 1** (PR1: IMAP fetcher + mail_messages + 一覧基盤) — 依存なし、最初に着手
2. **タスク 2** (PR2: 添付保存 + 抽出) — タスク 1 完了 & マージ後
3. **タスク 3** (PR3: AI 抽出 + drafts) — タスク 2 完了 & マージ後
4. **タスク 4** (PR4: 承認 UI + events 拡張) — タスク 3 完了 & マージ後
5. **タスク 5** (PR5: cron + LINE + デプロイ) — タスク 3 完了後（タスク 4 とは並列でも可、ただしレビュー帯域の都合で直列推奨）

---

## 進捗追跡

各タスクの進捗は対応する GitHub Issue で管理する（Step 4c で作成）。  
PR マージ後、対応 Issue を close する。

## 想定総作業時間（参考）

| タスク | 想定時間 | 備考 |
|---|---|---|
| PR1 | 2-3 日 | scaffold + IMAP + 基本一覧 |
| PR2 | 1-2 日 | 各 extractor + bytea 配信 |
| PR3 | 2-3 日 | AI integration + プロンプト調整 |
| PR4 | 2 日 | UI + Server Actions + E2E |
| PR5 | 1-2 日 | LINE + systemd + docs |
| **合計** | **8-12 日** | レビュー期間を含めず |

レビューラウンド込みで 2〜3 週間程度を想定。
