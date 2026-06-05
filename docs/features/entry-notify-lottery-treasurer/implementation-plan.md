---
status: completed
---
# entry-notify-lottery-treasurer 実装手順書

要件定義書: [requirements.md](./requirements.md)

テストファースト（API/lib → 実装 → フロント → 実装 → E2E）で進める。
スキーマ追加はすべて nullable / enum 値追加のみ（既存データ・既存挙動は非破壊）。
すべて 1 PR（子 Issue を `Fixes` でまとめる）。**AI 抽出（schema.ts / prompt.ts）は本 PR では一切触らない**（title-split との衝突回避、要件 §5.3）。

## 実装タスク

### タスク1: DB スキーマ拡張 + migration
- [x] 完了
- **概要:** 抽選日カラムと、会計向け通知の once-ever 種別を追加する。非破壊（nullable + enum 値追加）。
- **変更対象ファイル:**
  - `packages/shared/src/schema/events.ts` — `lotteryDate: date('lottery_date', { mode: 'string' })`（nullable）を追加
  - `packages/shared/src/schema/enums.ts` — `eventLifecycleNotificationTypeEnum` に `'entry_applied_treasurer'` を追加
  - `packages/shared/drizzle/` — 新規 migration を `db:generate`（連番は最新+1。**現状 main は 0020（title-split #111 反映済）→ 0021**）
- **依存タスク:** なし
- **対応Issue:** #113
- **完了条件:** `pnpm --filter @kagetra/shared check-types` green、migration が `lottery_date` 追加と `ADD VALUE 'entry_applied_treasurer'` を含む、shared の vitest が green。

### タスク2: 通知文面テンプレの拡張（lib）
- [ ] 完了
- **概要:** 参加者向け（抽選日追記）と会計向け（振込方法・期限）の文面生成を追加する。push / claim / finalize は既存ヘルパーをそのまま使う。
- **変更対象ファイル:**
  - `apps/web/src/lib/event-lifecycle-notify.ts` — `LifecycleMessageContext` に `lotteryDateIso?` / `paymentMethod?` / `paymentInfo?` / `paymentDeadlineIso?`（or 既存 `dateIso` 流用）を追加。`buildLifecycleMessage` に `entry_applied` の抽選日追記と `entry_applied_treasurer` の文面（期限/方法/詳細、全空なら最小文面、金額は載せない）を実装。exhaustiveness guard に新ケース追加
  - `apps/web/src/lib/event-lifecycle-notify.test.ts` — 抽選日あり/なし、会計向けの 期限のみ/方法のみ/詳細あり/全空、金額非表示 の各パターン
- **依存タスク:** タスク1（enum 値が必要）
- **対応Issue:** #114
- **完了条件:** 上記ユニットテストが green、`buildLifecycleMessage` の戻り文字列が要件 §3.2.2 / §3.2.3 と一致。

### タスク3: 申込完了 server action の 2通送信化
- [ ] 完了
- **概要:** `setEntryApplied(true)` の初回遷移で、参加者向け（抽選日追記）と会計向け（2通目）を once-ever で送る。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/[id]/actions.ts` — `setEntryApplied`：flip の `returning` に `lotteryDate` / `paymentMethod` / `paymentInfo` / `paymentDeadline` を追加。同一 tx で `entry_applied` と `entry_applied_treasurer` を claim。コミット後に 2 通 push（各 try/catch、best-effort）。cancelled は 2 通とも claim しない
  - `apps/web/src/app/(app)/events/[id]/lifecycle-actions.test.ts` — 2 claim + 2 push、再トグルで再送なし（UNIQUE）、cancelled で送信なし、未紐付けで skipped＋スロット消費
- **依存タスク:** タスク1・タスク2
- **対応Issue:** #115
- **完了条件:** 統合テスト green（`LINE_NOTIFY_DRY_RUN=1`）、`apps/web` check-types green。

### タスク4: 抽選日の入力（フォーム + スキーマ + 作成/編集保存 + 参照表示）
- [ ] 完了
- **概要:** 抽選日を手動入力・保存できるようにする。詳細画面に参照表示（任意）。
- **変更対象ファイル:**
  - `apps/web/src/lib/form-schemas.ts` — `eventFormSchema` に `lotteryDate: optionalDateStr`、`extractEventFormData` に `lotteryDate: formData.get('lotteryDate')`
  - `apps/web/src/components/events/event-form.tsx` — `defaultValues.lotteryDate` を受け、`name="lotteryDate"` の `date` 入力を締切群付近に追加
  - `apps/web/src/app/(app)/events/new/page.tsx` — insert に `lotteryDate` 反映
  - `apps/web/src/app/(app)/events/[id]/edit/page.tsx` — update に `lotteryDate` 反映、`defaultValues.lotteryDate` 受け渡し
  - `apps/web/src/app/(app)/events/[id]/page.tsx` — 抽選日の参照表示（任意・参加費/締切と並べて、会員も参照可）
  - `apps/web/src/lib/form-schemas.test.ts` / `apps/web/src/components/events/event-form.test.tsx` — `lotteryDate` のパース/描画テスト
- **依存タスク:** タスク1
- **対応Issue:** #116
- **完了条件:** フォームスキーマ/コンポーネントのテスト green、新規作成・編集で `lottery_date` が保存・再表示される。
- **注意（並行作業）:** `form-schemas.ts` は title-split も改修するため、マージ時に rebase で吸収（追加的変更）。`event-form.tsx` は title-split 側で「据え置き」想定だが、フィールド追加は additive に留める。

### タスク5: E2E
- [ ] 完了
- **概要:** 抽選日入力 → 申込済トグル（DRY_RUN）→ 会員の参照のみ、までのハッピーパス。
- **変更対象ファイル:**
  - `apps/web/e2e/` — `/events/[id]/edit` で抽選日入力→保存、`/events/[id]` で申込済トグルが例外なく完了、会員には抽選日が参照のみ表示されること（既存の lifecycle / events E2E に追記 or 新規 spec）
- **依存タスク:** タスク3・タスク4
- **対応Issue:** #117
- **完了条件:** E2E green、CI（型/lint/test/E2E）通過。

## 実装順序
1. タスク1（DB・依存なし）
2. タスク2（lib・タスク1 に依存）
3. タスク3（server action・タスク1,2 に依存）
4. タスク4（フォーム/入力・タスク1 に依存。タスク2,3 と並行可）
5. タスク5（E2E・タスク3,4 に依存）

## マージ / 並行作業メモ
- ブランチは **現在の main（title-split #111 反映済）から分岐**（`feature/entry-notify-lottery-treasurer` 想定）、worktree は `C:/tmp/...` に明示作成（Windows パス罠回避）。
- **title-split は PR #111 でマージ済（`e664b3d`、migration 0020）→ 当初の衝突懸念は解消**。in-flight rebase 不要。`events.ts` / migration journal / `form-schemas.ts` は title-split 変更済みの上に追加するだけ（追加的）。
- 抽選日の **AI 自動抽出は本 PR に含めない**。main に載った新 `EventUnitSchema`（`apps/mail-worker/src/classify/schema.ts`）へ `lottery_date` を追加＋プロンプト調整する **別 follow-up（本 PR の後）** で対応（要件 §5.3・§7）。
