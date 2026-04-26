---
status: in_progress
issue: 15
parent_issue: 11
branch: feat/mail-tournament-import-pr4
worktree: /tmp/impl-mail-pr4
---

# PR4 実装計画 — 承認 UI + events 拡張

PR3（[#19](https://github.com/poponta2020/kagetra_new/pull/19), `f441798`）で `tournament_drafts` 永続化と一覧画面の信頼度バッジまでが merge 済み。本 PR で承認ワークフロー UI（詳細画面 + Server Actions）と `events` 拡張カラム 11 個を追加し、`/admin/mail-inbox/[id]` で「AI 抽出値で pre-fill された events フォーム → 承認で events INSERT」フローを完成させる。

## 確定事項（2026-04-27 grill-me）

| # | 質問 | 採用 |
|---|---|---|
| Q1 | 「再 AI 抽出」の実行方式 | **A. web Server Action から `classifyMail` + `persistOutcome` を同期 await。web 側 env に `ANTHROPIC_API_KEY` を追加** |
| Q2 | 訂正版 (`is_correction=true`) の関連 draft 検出 | **A. `references_subject` を `subject` / `formal_name` / `title` に **ILIKE '%...%'** で部分一致、直近 12 ヶ月、上位 3 件** |
| Q3 | 「既存 events に紐付ける」候補絞り込み | **A. 直近 6 ヶ月の events を `title` / `formal_name` で部分一致 + select dropdown** |
| Q4 | 「保留」ボタン | **A. 削除し、画面離脱（パンくずクリック）= 保留扱い** |
| Q5 | 却下時の confirmation | **A. 「却下理由」textarea を必須化（理由空なら submit disabled）** |
| Q6 | Playwright E2E スコープ | **C. ハッピーパス + 却下 + 再抽出（reextract は LLM mock）** |

## 既存資産（PR1-PR3 で揃っているもの）

- `tournament_drafts` テーブル（`event_id`, `approved_by_user_id`, `rejected_by_user_id`, `approved_at`, `rejected_at`, `rejection_reason`, `superseded_by_draft_id` カラムは既存）
- `/admin/mail-inbox/page.tsx` 一覧画面 + `DraftCard`, `ConfidenceBadge`, `AttachmentList` コンポーネント
- `apps/mail-worker/src/classify/classifier.ts` の `classifyMail` + `persistOutcome` (純粋関数化済み、reextract.ts でも再利用)
- `apps/mail-worker/src/classify/llm/anthropic.ts` の `AnthropicSonnet46Extractor` + `LLMExtractor` 抽象化
- `apps/web/src/components/events/event-form.tsx` (247 行、新カラム追加対象)
- `apps/web/src/lib/form-schemas.ts` の `eventFormSchema` (Zod、新カラム追加対象)
- E2E 基盤 (`apps/web/e2e/global-setup.ts` で Drizzle schema apply 済み、PR2/PR3 で動作実績あり)

## 実装フェーズ

### Phase 0: Worktree + branch 作成
- main から `feat/mail-tournament-import-pr4` を切る
- worktree を `/tmp/impl-mail-pr4` に作成
- `corepack pnpm install`（mail-worker 同様、web も依存解決）
- migration 番号 0009 を予約（drizzle-kit が自動採番してくれるが、衝突可能性は事前に `git log --all --oneline | grep 0009` で確認）

### Phase 1: events 拡張 + migration
- `packages/shared/src/schema/events.ts` に 11 カラム追加（全部 nullable）:
  - `feeJpy: integer`, `paymentDeadline: date`, `paymentInfo: text`, `paymentMethod: text`, `entryMethod: text`, `organizer: text`
  - `capacityA..E: integer` (5 個)
- `corepack pnpm --filter @kagetra/shared db:generate` で `0009_<auto>.sql` を生成
- 既存テストが回ること（events.ts の既存 SELECT/INSERT は触らない）
- check-types pass

### Phase 2: form-schemas + EventForm 拡張
- `apps/web/src/lib/form-schemas.ts`:
  - `eventFormSchema` に 11 フィールド追加（Zod、全部 optional）
  - `extractEventFormData` を 11 フィールド対応に拡張
- `apps/web/src/components/events/event-form.tsx`:
  - 既存の defaults プロパティに 11 フィールド追加
  - フォーム上は「料金/締切/申込/主催」セクション + 「級別定員 (A〜E)」セクションの 2 グループに分けて配置
- `apps/web/src/components/events/event-form.test.tsx`:
  - 新フィールドの存在 + 既存テストの非破壊を確認
- 既存 `/events/new` `/events/[id]/edit` の Server Action パスが通ること（フィールド追加だけなのでスキーマ的には吸収）

### Phase 3: ApprovalForm + ExtractedPayloadView + CorrectionHint
- `apps/web/src/app/(app)/admin/mail-inbox/components/ApprovalForm.tsx`:
  - `EventForm` を再利用、`defaultValues` に AI の `extracted_payload` から null-safe マッピング
  - 級別定員: `extracted.capacity_a..e` → `capacity_a..e` 1:1
  - `eligible_grades: string[]` → checkbox prefill
  - `kind` が AI null の場合は events のデフォルト `'individual'` を使う
- `apps/web/src/app/(app)/admin/mail-inbox/components/ExtractedPayloadView.tsx`:
  - 折りたたみ可能な JSON プレビュー（`<details>`）
  - `extracted_payload` を 2 カラム表示（field name → 値）
- `apps/web/src/app/(app)/admin/mail-inbox/components/CorrectionHint.tsx`:
  - props: `referencesSubject: string | null`、自身でクエリせず Server Component で受け取る形
  - 候補が無い場合は何もレンダーしない

### Phase 4: Server Actions (`actions.ts`)
新規 `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`:
- `approveDraft(draftId, formData)`:
  1. auth check (admin/vice_admin)
  2. `eventFormSchema.parse(extractEventFormData(formData))`
  3. transaction:
     - `events` INSERT
     - `tournament_drafts` UPDATE: status='approved', event_id=<新>, approved_by_user_id=session.user.id, approved_at=now()
  4. revalidatePath
- `rejectDraft(draftId, formData)`:
  1. auth check
  2. `rejection_reason` textarea を validate (空文字 → reject、Q5 採用)
  3. UPDATE: status='rejected', rejected_by_user_id, rejected_at, rejection_reason
- `reextractDraft(draftId)`:
  1. auth check
  2. `loadLlmConfig()` を web 側でも使えるよう packages/shared に移すか、apps/web に複製（後者を採用、shared 移動は副作用範囲が大きい）
  3. `apps/mail-worker/src/classify/classifier.ts` の `classifyMail` + `persistOutcome` を import（web から mail-worker への workspace dep）
  4. 同期 await で実行、`approved`/`rejected` draft は PR3 の `upsertDraft` ガードで保護される
  5. revalidatePath
- `linkDraftToEvent(draftId, eventId)`:
  1. auth check
  2. event 存在確認
  3. UPDATE: status='approved', event_id=<指定>, approved_by_user_id, approved_at（既存 events 紐付けでも approved 扱い）

### Phase 5: 詳細画面 `/admin/mail-inbox/[id]/page.tsx`
- `params.id` の draft をロード（mailMessage + attachments + draft の relation query）
- 訂正版 hint:
  - サーバー側で `referencesSubject` が non-null の場合、`drafts` + `events` を ILIKE で検索（直近 12 ヶ月、各 top-3）
  - 結果を `CorrectionHint` に渡す
- 既存 events 紐付け候補:
  - 直近 6 ヶ月の events を全件取得（多くないので memory join で OK）、`extracted.title` / `formalName` で前段絞り込みは初期は不要、select dropdown に全件
- 構成:
  1. ヘッダー: パンくず ← 一覧
  2. 元メール情報カード（subject, from, receivedAt, body preview, AttachmentList）
  3. CorrectionHint（あれば）
  4. ExtractedPayloadView (collapsed)
  5. ApprovalForm (EventForm 再利用、AI prefill)
  6. アクションバー: 承認 (form submit) / 却下 (理由 textarea + reject submit) / 再抽出 (button) / 既存 events に紐付け (select + button)
- auth gate: PR1 で導入済の `/admin/mail-inbox/*` middleware で吸収

### Phase 6: 環境変数 + LLM config 共有
- `apps/web/.env.example` （無ければ root の `.env.example`）に `ANTHROPIC_API_KEY` を追記（既に root に存在するはず → 確認のみ）
- `apps/web/src/lib/llm-config.ts` を新規作成、`apps/mail-worker/src/config.ts` の `loadLlmConfig` を参照（重複定義は避け、shared に置くか re-export）
- 採用: `apps/mail-worker/src/config.ts` を named export に整理し、web から workspace dep 経由で import（実質パッケージ間 import）

### Phase 7: Tests
- **Vitest (web)**:
  - `actions.test.ts`: 4 アクションの正常系 + 認可拒否 + 不正入力 (test-db 経由、PR3 の seed 流用)
  - `ApprovalForm` の prefill 挙動（null safety）
  - `event-form.test.tsx` 拡張（新フィールド存在 + 既存非破壊）
  - `form-schemas` の新 schema validation
- **Vitest (mail-worker)**: 既存 128 件の維持確認（events 拡張の影響なし、純粋に web 側変更）
- **Playwright E2E** (`apps/web/e2e/admin-mail-inbox-approval.spec.ts` 新規):
  - **Happy**: seed draft (pending_review, sample payload) → admin login → /admin/mail-inbox → click into [id] → 承認 button → events 一覧に表示確認 + draft.status='approved' 確認
  - **Reject**: seed draft → 却下理由入力 → 却下 button → events 作成されないこと + draft.status='rejected' 確認
  - **Reextract**: seed draft + LLM mock fixture → 再抽出 button → mock 経由で `extracted_payload` が更新 + draft.promptVersion 更新確認
- E2E 用に `FixtureLLMExtractor` を web 側でも使う仕掛けが必要 → web の Server Action 内で env `LLM_PROVIDER=fixture` を読んで分岐するか、E2E 専用の DI port を設ける

### Phase 8: Final QA + PR
- `corepack pnpm --filter @kagetra/web check-types` ✅
- `corepack pnpm --filter @kagetra/mail-worker check-types` ✅（regression 確認）
- `corepack pnpm --filter @kagetra/web test` ✅
- `corepack pnpm --filter @kagetra/mail-worker test` ✅
- `corepack pnpm --filter @kagetra/web exec playwright test admin-mail-inbox-approval` ✅
- 手動確認: `/events/new` の新フィールドが空のまま保存できる（既存ユーザーの非破壊）
- gh pr create with description (#15 closes、関連 PR #19 link)

## DoD (Issue #15 より)

- [ ] 既存 events / EventForm の振る舞いが回帰しない
- [ ] 新カラムが空でも events 作成可能
- [ ] `/admin/mail-inbox/[id]` で AI 抽出値が pre-fill された ApprovalForm が表示
- [ ] 「承認」で events INSERT + draft.status='approved' & event_id 更新
- [ ] 「却下」で draft.status='rejected'、events 作成されない
- [ ] 「再 AI 抽出」で extracted_payload 更新
- [ ] 訂正版 draft の詳細画面で類似 draft / events リンク表示
- [ ] 「既存 events に紐付ける」で event_id が指定 event を指す
- [ ] Playwright E2E ハッピーパス + 却下 + 再抽出 PASS
- [ ] vitest で EventForm 拡張テスト PASS
- [ ] check-types / lint / vitest / E2E が CI 通過
