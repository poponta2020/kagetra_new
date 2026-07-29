---
status: completed
---

# grade-entry-fee 実装手順書（改修: 表示・通知への配線）

> 第1回（PR #392・定数の保持／Issue #390・#391）は出荷済み。本書は**今回の改修のタスクで上書き**している
> （完了済みの旧タスクは git 履歴が保持する）。要件は [requirements.md](./requirements.md)。AC 28件（全て auto-test）。

## 技術設計の骨子

**モジュール構成（新規2本）**

| ファイル | 責務 | DB |
|---|---|---|
| `apps/web/src/lib/entry-fee.ts` | 単価解決・同単価グルーピング・表示整形（**純関数のみ**） | 触らない |
| `apps/web/src/lib/entry-fee-tally.ts` | 参加者の級別内訳と総額の集計クエリ | 触る |

純関数と DB を分けるのは、`buildLifecycleMessage`（純関数のテスト）と画面の双方から単価解決を使うため。
`entry-fee.ts` に db import が入るとメッセージのユニットテストが DB に依存する。

**`buildLifecycleMessage` の拡張方針（バイト互換の担保）**

`LifecycleMessageContext` に**任意フィールドだけ**を足し、既存 `feeJpy` 引数は残す。
未指定なら現行の分岐にそのまま落ちるため、既存アサーションを1文字も変えずに AC-14/15/19/20 が通る。

```ts
/** 多級のときの級別単価表記（例: 'A・B級 2,500円 / C級 2,000円'）。未指定なら feeJpy の現行分岐 */
unitPricesLabel?: string | null
/** 振込総額（payment_deadline_* / payment_paid）。null / 0 なら金額行を出さない */
totalJpy?: number | null
/** 内訳（例: 'A・B級 2名×2,500 / C級 3名×2,000'） */
breakdownLabel?: string | null
/** 級未設定で未算入の人数。0 なら注記を出さない */
unknownGradeCount?: number
```

整形は `entry-fee.ts` に集約し、`event-lifecycle-notify.ts` へは**整形済み文字列**を渡す
（金額の数値整形だけは既存 `formatFeeAmount` を使い、桁区切りの流儀を1箇所に保つ）。

**マイグレーション 0052**

```sql
ALTER TABLE "events" ALTER COLUMN "payment_type" SET DEFAULT 'advance';
--> statement-breakpoint
UPDATE "events" SET "payment_type" = 'advance' WHERE "payment_type" IS NULL;
```

`packages/shared/src/schema/events.ts` の `paymentType` に `.default('advance')` を付ける。
列は **nullable のまま**（`onsite` からの往復や将来の「通知しない」表現を潰さないため）。

---

## 実装タスク

### タスク1: 単価解決の純関数

- [x] 完了
- **目的:** イベントと級から単価を解決し、同単価の級をまとめて表示用文字列にする土台を作る
- **対応AC:** AC-5, AC-6, AC-7, AC-8
- **主な変更領域:** 新規 `apps/web/src/lib/entry-fee.ts` / 新規 `apps/web/src/lib/entry-fee.test.ts`
- **依存タスク:** なし
- **必要なテスト（テストファースト）:**
  - `official=true`・`kind='individual'` で `feeJpy=9999` でも**級から導出する**（AC-5）
  - `official=false` / `kind='team'` は `feeJpy` をそのまま返す（AC-6）
  - `eligible_grades` が NULL / 空配列で全級 A〜E を対象にする（AC-7）
  - `{A,B,C}` → `A・B級 2,500円 / C級 2,000円`、並びが A→E（AC-8）
  - `{A,B}` は同単価なので単一料金と判定される
  - 級が null・未知値のとき単価を解決しない（`officialEntryFeeJpy` の契約を素通しする）
- **完了条件:** `pnpm --filter=@kagetra/web test entry-fee` green・`check-types` 通過
- **対応Issue:** #424

### タスク2: payment_type の既定値変更とバックフィル

- [x] 完了
- **目的:** 「参加費は基本前払い」を既定値に反映し、支払締切リマインドが構造的に黙る状態を解消する
- **対応AC:** AC-26, AC-27
- **主な変更領域:** `packages/shared/src/schema/events.ts`（`paymentType` に `.default('advance')`）/
  新規 `packages/shared/drizzle/0052_*.sql` / `packages/shared/drizzle/meta/`
- **依存タスク:** なし
- **必要なテスト:**
  - 新規 INSERT で `payment_type` を省略すると `'advance'` が入る（AC-26）
  - backfill 後、元 NULL の行が `'advance'` に、`'onsite'` / `'advance'` の既存行は不変（AC-27）
- **完了条件:** migration 適用後に上記テストが green
- **対応Issue:** #425
- **注意:** 番号は着手時に `meta/_journal.json` の最新を再確認する（本書執筆時点の次番は **0052**）。
  **列を変えるため各 worktree のテスト DB は破棄して作り直す**（旧スキーマのまま `push` すると対話プロンプトで詰む）。
  本番反映は `db:migrate`。**既存データの書き換えを含むため、要件 §破壊的変更 の承認済み事項**。

### タスク3: 参加者の級別内訳・総額の集計

- [ ] 完了
- **目的:** イベント／グループ単位で「級ごとの人数 × 単価」と総額を引く
- **対応AC:** AC-9, AC-10, AC-11, AC-12
- **主な変更領域:** 新規 `apps/web/src/lib/entry-fee-tally.ts` / 新規 `apps/web/src/lib/entry-fee-tally.test.ts`
- **依存タスク:** タスク1
- **必要なテスト:**
  - 母集団が `attend=true` ∩ `is_invited=true` ∩ 対象級に一致する（AC-9。
    `page.tsx` の `eligibleAttendingList` と**同じ集合**になることをテストで固定する）
  - 級未設定の会員が総額に加算されず `unknownGradeCount` に計上される（AC-10）
  - `kind='team'` / `official=false` では総額を算出しない（AC-11）
  - 複数イベント（グループ全日）を渡すと合算され、日別に割られない（AC-12）
  - 参加者0名なら総額 0・内訳なしを返す（金額行を出さない側の入力になる）
- **完了条件:** 実 DB テスト green
- **対応Issue:** #426
- **注意:** `eligible_grades` は enum 配列。raw SQL で渡すなら `ANY(ARRAY[...])` 形式にし、
  **空配列は early-return** する。イベントごとに対象級が違うため、グループ合算は
  **イベント単位でフィルタしてから合算**する（グループ全体で一括フィルタしない）。

### タスク4: 通知文面の拡張

- [ ] 完了
- **目的:** 支払締切リマインドに総額行を足し、現地払い・支払完了の金額を導出値へ移す
- **対応AC:** AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20
- **主な変更領域:** `apps/web/src/lib/event-lifecycle-notify.ts`（`LifecycleMessageContext` と
  `buildLifecycleMessage`）/ `apps/web/src/lib/event-lifecycle-notify.test.ts`
- **依存タスク:** タスク1
- **必要なテスト:**
  - `payment_deadline_advance/day`: 1行目が現行文面と完全一致し、2行目に `振込総額 …（内訳）`（AC-13）
  - 総額 null / 0 で現行文面と**バイト単位で一致**（AC-14）
  - `unknownGradeCount > 0` で `※級未設定 N名は未算入` が3行目に付く。0 なら出ない
  - `onsite_payment_advance/day`: `unitPricesLabel` 未指定で**既存アサーションがそのまま通る**（AC-15）
  - `onsite_payment_advance/day`: `unitPricesLabel` 指定で級別表記（AC-16）
  - `payment_paid`: `参加費（総額 11,000円）の支払いが完了しました。`（AC-17）
  - `payment_paid` の複数日は金額なしのまま（AC-18）
  - `entry_applied_treasurer` / `entry_applied` / `entry_deadline_*` の既存アサーションを**変更しない**（AC-19, AC-20）
- **完了条件:** `event-lifecycle-notify.test.ts` green・`check-types` 通過
- **対応Issue:** #427
- **注意:** **既存アサーションを触ってよいのは `payment_paid` の2件だけ。** 他を書き換えると
  バイト互換の担保が崩れる（要件 §破壊的変更 2）。

### タスク5: 支払締切リマインドへの配線

- [ ] 完了
- **目的:** 日次バッチが総額つきの文面を送れるようにする（単一日・複数日バケットの両方）
- **対応AC:** AC-12, AC-13, AC-14
- **主な変更領域:** `apps/web/scripts/send-lifecycle-reminders.ts` /
  `apps/web/scripts/__tests__/send-lifecycle-reminders.test.ts`
- **依存タスク:** タスク3, タスク4
- **必要なテスト:**
  - 単一日の `payment_deadline_*` に総額行が付く
  - 複数日バケットで、日別ラベルは対象日だけ・総額は**グループ全日の合算**になる（AC-12）
  - 参加者0名・団体戦・非公認で総額行が出ず、文面が現行と一致する（AC-14）
  - `entry_deadline_*` / `onsite_payment_*` のバケット文面が現行と一致する（回帰）
- **完了条件:** スクリプトのテスト green・`--dry-run` が例外なく完走
- **対応Issue:** #428
- **注意:** 複数日テンプレートの持ち主は `buildBucketMessage`（既存コメント）。日別ラベルの整形は
  `sortDays` / `formatDaysLabel` を引き続き import して使い**二重定義しない**。
  総額はバケットの対象日ではなく**グループの全日**から引く（要件 §3.2.2）。

### タスク6: 支払完了通知を総額へ

- [ ] 完了
- **目的:** 「支払済にする」で飛ぶ完了通知の金額を、1人あたり額から実際に振り込んだ総額へ変える
- **対応AC:** AC-17
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/actions.ts`（`buildPaymentPaidMessage` と
  `setPaymentPaid` / `setPaymentsPaid`）/ `apps/web/src/app/(app)/events/[id]/lifecycle-actions.test.ts`
- **依存タスク:** タスク3, タスク4
- **必要なテスト:**
  - 単一イベントの支払済で `参加費（総額 N円）` が送られる
  - 総額が算出できない（団体戦・非公認・参加者0名）とき現行の金額省略分岐に落ちる
  - 複数日一括は現行どおり金額なし（AC-18 の回帰）
  - once-ever・cancelled スキップ・claim/finalize の既存挙動が不変
- **完了条件:** `lifecycle-actions.test.ts` green
- **対応Issue:** #429
- **注意:** `buildPaymentPaidMessage` は N=1 バイト互換のために単一日ロジックへ素通ししている。
  総額の取得は**トランザクション外（flip 後）**で行い、既存の claim 順序を変えない。

### タスク7: イベント詳細画面への表示

- [ ] 完了
- **目的:** 会員に「あなたの参加費」を、管理者に総額と内訳を出す
- **対応AC:** AC-21, AC-22, AC-23, AC-24, AC-25
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/page.tsx` /
  `apps/web/src/components/events/EventLifecycleSection.tsx` / それぞれの `.test.tsx`
- **依存タスク:** タスク1, タスク3
- **必要なテスト:**
  - 対象級の会員に「あなたの参加費 2,500円」が**出欠の回答状況に関わらず**出る（AC-21）
  - 級未設定・対象級外・`kind='team'` では出ない（AC-22）
  - 「規定額」等のラベルが付かない（AC-23）
  - 管理者の進行管理に「振込総額」行が出る／多級で「参加費」行が級別表記になる（AC-24）
  - **`EventLifecycleSection` の既存 props 契約が不変**（`feeJpy=null` で参加費の行を出さない。
    既存テストを**変更せずに**通す）（AC-25）
- **完了条件:** 両テスト green・`check-types` 通過
- **対応Issue:** #430
- **注意:** **導出はページ側（Server Component）で行う。** `EventLifecycleSection` へは解決済みの値を渡し、
  総額・内訳は**任意の新規 props**として足す。component 内で導出しない（既存テストが `feeJpy` scalar の
  契約を固定しているため／AC-25）。会員向け1行は既存「参加者」`SectionRule` 内に置き、
  レイアウト・配色は変えない。

---

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1, タスク2** — 純関数（`apps/web/src/lib/entry-fee.ts`）と schema/migration
  （`packages/shared`）で変更領域が完全に直交
- **Wave 2: タスク3, タスク4** — どちらもタスク1 のみに依存。`lib/entry-fee-tally.ts` と
  `lib/event-lifecycle-notify.ts` で直交
- **Wave 3: タスク5, タスク6, タスク7** — `scripts/send-lifecycle-reminders.ts` /
  `app/(app)/events/[id]/actions.ts` / `page.tsx`＋`components/events/EventLifecycleSection.tsx` で
  互いに直交（page.tsx は actions.ts を import するが編集しない）

AC-28（既存テスト・lint・typecheck が CI で green）は全 Wave を通じた横断条件で、CI が確認する。
