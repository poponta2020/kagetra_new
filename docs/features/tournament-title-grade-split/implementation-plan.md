---
status: completed
---
# tournament-title-grade-split 実装手順書

要件定義書: [requirements.md](./requirements.md)

テストファースト（API/worker → 実装 → フロント → 実装 → E2E）で進める。
すべて nullable 追加 + コード吸収のため、既存データ・既存イベントは非破壊。

## 実装タスク

### タスク1: DB スキーマ拡張 + migration
- [x] 完了
- **概要:** `events` に AI 由来イベントの元ドラフトを記録する 2 カラムを追加し、1ドラフト:Nイベントを表現可能にする。非破壊（nullable + FK ON DELETE SET NULL）。
- **変更対象ファイル:**
  - `packages/shared/src/schema/events.ts` — `tournamentDraftId` (integer, FK → tournament_drafts.id, ON DELETE SET NULL)、`tournamentDraftUnitKey` (text) を追加
  - `packages/shared/src/schema/relations.ts` — events ↔ tournamentDrafts の relation 追加
  - `packages/shared/drizzle/` — 新規 migration（連番は既存最新+1 を確認して衝突回避）。`db:generate` で生成
  - `tournament_drafts.event_id` の用途（訂正紐付け専用）をスキーマコメントに明記
- **依存タスク:** なし
- **対応Issue:** #103
- **完了条件:** `db:generate` で migration 生成、ローカル & テスト DB に `db:migrate` 適用成功、型チェック通過、既存テスト green。

### タスク2: AI 抽出スキーマの配列化
- [x] 完了
- **概要:** `ExtractionPayloadSchema` を「案内全体 + イベント単位配列」形へ変更（破壊的）。`short_name_stem` と `events[]`（`EventUnitSchema`）を導入。
- **変更対象ファイル:**
  - `apps/mail-worker/src/classify/schema.ts` — `EventUnitSchema`（unit_key/event_date/eligible_grades/formal_name/venue/fee_jpy/payment_*/entry_*/organizer_text/kind/capacity_a..e/official）、top-level に `short_name_stem` + `events: z.array(...)`、`extracted` を削除
  - `apps/mail-worker/test/` — スキーマの Zod パステスト（分割2件・単一1件・noise空配列・不正形 reject）を追加/更新
  - `ExtractionPayload` 型を参照する箇所の型追従（`ApprovalForm` props 等はタスク6で対応）
- **依存タスク:** なし
- **対応Issue:** #104
- **完了条件:** Zod スキーマテスト green、`@kagetra/mail-worker` の型チェック通過。

### タスク3: プロンプト刷新 + title 合成ロジック
- [x] 完了
- **概要:** プロンプトを配列出力 + 短縮命名ルールに刷新し、PROMPT_VERSION を 2.0.0 に上げる。級サフィックスは決定論合成。
- **変更対象ファイル:**
  - `apps/mail-worker/src/classify/prompt.ts` — `PROMPT_VERSION='2.0.0'`、`short_name_stem`/`events[]`/分割ルール/級別・共通フィールドのガイダンス、few-shot 4 例（単一複数級=東大阪ABC / 開催日分割=大阪B・C / noise / 訂正）。cache 2048 token 維持を確認
  - `apps/mail-worker/src/classify/` — `composeTitle(stem, grades)` ヘルパー（grades を A→E 順連結、空/未指定なら stem のみ）を新規 + ユニットテスト
- **依存タスク:** タスク2
- **対応Issue:** #105
- **完了条件:** `composeTitle` のユニットテスト green（ABC連結・全級ABCDE・stemのみ・順序非依存）、プロンプト変更後の smoke（`--dry-run --mock-llm` 等）で例が新形式を返すこと。

### タスク4: classifier / persistOutcome 追従 + fixtures
- [x] 完了
- **概要:** 新 payload を `tournament_drafts.extracted_payload` に保存する経路を新形式に追従させ、fixture / 期待 JSON を更新。
- **変更対象ファイル:**
  - `apps/mail-worker/src/classify/classifier.ts` — `persistOutcome` の参照を新形式へ（top-level の confidence/is_correction/references_subject は不変、`is_tournament_announcement` + `events:[]` で noise 判定）。title 合成の適用箇所（pipeline 保存時 or フォーム初期化時）を確定して実装
  - `apps/mail-worker/test/fixtures/*` — 分割・単一・noise・訂正の eml と期待 payload を新形式へ更新
  - `apps/mail-worker/test/*.test.ts` — classify / pipeline 統合テスト更新
- **依存タスク:** タスク2, タスク3
- **対応Issue:** #106
- **完了条件:** worker のユニット/統合テスト green、`reextractDraft` 経由でも新形式が保存されること（タスク5のガードと整合）。

### タスク5: 承認 Server Actions（複数イベント承認）
- [x] 完了
- **概要:** 単一イベント承認を複数単位承認に拡張。部分承認・完了・再抽出ガード・LINE 配信重複排除を実装。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `approveDraftUnits(draftId, units)`（選択単位を1txで INSERT、`tournamentDraftId`/`unitKey`/`createdBy` 付与、全単位完了で draft=approved + mail archived/processed、残あれば pending 維持）、`completeDraft(draftId)`、`reextractDraft` に「materialize 済みイベントあれば拒否」ガード追加、承認後 broadcast を**紐付け LINE グループ単位で重複排除**して発火
  - `apps/web/src/lib/form-schemas.ts` — 単位配列パース helper（`extractEventUnitsFormData` 等）。既存の単一フォーム経路（events/new・edit）は不変
  - `apps/web/.../mail-inbox/actions.test.ts` — 一括/一部/全完了の draft 状態遷移、completeDraft、reextract ガード、broadcast 重複排除のテスト
- **依存タスク:** タスク1, タスク2
- **対応Issue:** #107
- **完了条件:** actions テスト green、テスト DB で複数イベント INSERT と draft 状態遷移・mail processed 連動・broadcast 1グループ1回を検証。

### タスク6: 承認画面 UI（複数単位フォーム）
- [x] 完了
- **概要:** 承認画面を `events[]` 単位のフォームリストに拡張。旧形式 payload を正規化表示。
- **変更対象ファイル:**
  - `apps/web/.../mail-inbox/components/ApprovalForm.tsx` — `payload.events[]` をループし単位ごとに `EventForm` + 登録チェックボックス、title 合成値で pre-fill、登録済み単位は無効表示。旧形式（`extracted`）を 1 単位配列へ正規化
  - `apps/web/.../mail-inbox/components/DraftCard.tsx` — 分割大会名・件数表示（例「大阪B, 大阪C（2件）」）
  - `apps/web/.../mail-inbox/[id]/page.tsx` — 新フォーム呼び出し、`completeDraft` ボタン配線、登録済み単位の表示
  - `apps/web/.../mail-inbox/components/ApprovalForm.test.tsx` ほか — 複数単位描画・チェック選択・旧形式正規化のテスト
- **依存タスク:** タスク2, タスク5
- **対応Issue:** #108
- **完了条件:** component テスト green、型チェック・lint 通過、手元で分割案内ドラフトを開いて N フォーム表示・選択登録できること。

### タスク7: E2E + 移行確認
- [ ] 完了
- **概要:** 複数イベント承認のハッピーパスと、旧形式 payload の後方互換を E2E/手動で確認。
- **変更対象ファイル:**
  - `apps/web/e2e/` （または既存 Playwright 構成）— 分割案内ドラフトを seed → 承認画面で 2 件 → 一部登録 → 「残りは作らず完了」までのハッピーパス
  - 旧形式 payload の pending ドラフトが承認画面で壊れず表示・承認できることの確認シナリオ
- **依存タスク:** タスク1〜6
- **対応Issue:** #109
- **完了条件:** E2E green、CI 通過、旧形式正規化の回帰なし。

## 実装順序
1. タスク1（DB スキーマ + migration、依存なし）
2. タスク2（AI 抽出スキーマ配列化、依存なし）
3. タスク3（プロンプト + title 合成、タスク2 依存）
4. タスク4（classifier/persist + fixtures、タスク2・3 依存）
5. タスク5（承認 Server Actions、タスク1・2 依存）
6. タスク6（承認画面 UI、タスク2・5 依存）
7. タスク7（E2E + 移行確認、全タスク依存）
