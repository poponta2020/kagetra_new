---
name: ship-grade-entry-fee
description: 級別参加費を画面と LINE 通知へ配線する
type: project
---

**級別参加費を画面と LINE 通知へ配線する** — PR #432 https://github.com/poponta2020/kagetra_new/pull/432（branch feature/grade-entry-fee・全9コミット）

第1回（PR #392・定数の保持）に続く第2回。**「金額を足す」だけでなく「金額が消えるのを防ぐ」出荷**でもある — #410/#411 で AI の `fee_jpy` 抽出が廃止されるため、`fee_jpy` を読んでいた箇所を導出へ移さないと金額表示が無言で消える。

## 単価解決の正典
`apps/web/src/lib/entry-fee.ts`（純関数・DB を触らない）の `resolveEntryFee` が唯一の判定。
`official=true かつ kind='individual'` → **events.fee_jpy を一切見ず**級別規定額を導出／それ以外（非公認・団体戦）→ `fee_jpy` そのまま。**`fee_jpy ?? 導出` ではない**。

## 出荷内容（タスク7件・Issue #423〜#430 すべてクローズ）
- `lib/entry-fee.ts` / `lib/entry-fee-tally.ts` 新規
- イベント詳細: 全ロールへ「あなたの参加費」1行（個人戦のみ・対象級のみ・出欠の回答状況を問わない）／管理者は参加費行を導出値へ＋「振込総額」行を新設
- 支払締切リマインド: 2行目に `振込総額 N円（内訳）`（総額なし・0円なら現行文面とバイト単位で一致）
- 現地払い: 導出単価へ。単一料金は現行文面のまま、多級のみ級別表記
- 支払完了: 1人あたり額 → **振込総額**（範囲は申込グループ単位）
- `entry_applied_treasurer` は変更なし（「金額は載せない」既存決定を維持）
- migration 0052: `events.payment_type` の既定値 NULL→'advance' ＋既存 NULL の backfill

## レビュー（/auto-review-loop）
2ラウンド（initial + delta 1）・最終 verdict=pass・effort h→h・累計 **541,901/500,000 トークン**。
- **修正した blocker 1件**（3ff52bb）: 振込総額が現地払い・支払方法未設定の日まで合算していた。`setPaymentType` は1日単位で変更でき同一グループ内で支払方法が混在しうるため、事前払い2,500円＋現地払い1,500円で「振込総額 4,000円」と案内する経路があった（once-ever で訂正不能）。集計側を `payment_type='advance'` に絞った
- **WONTFIX 1件**（ユーザー判断）: once-ever 通知の総額が claim 時点のスナップショットに固定されない（コミット〜集計クエリ間の数ミリ秒）。総額は本来動く量で翌日の出欠変更でも同じくずれるため、内訳併記で会計が引き算できる設計を維持
- **final（全差分の最終確認）はユーザー判断でスキップ** — R1 が gpt-5.6-sol/high で全差分 8,700行を網羅レビュー済みで、以後の変更は R2 が確認した110行のみ。トークン上限超過の主因は差分の約6,000行が drizzle の 0052_snapshot.json（自動生成）だったこと
- **再レビューせずに修正した指摘: 0件**

## 残 DoD（本番で消化）
1. **migration は `db:migrate`**（`drizzle-kit push` は対話プロンプトで詰む）。既存 NULL 行が advance になり、進行管理の表示が「未設定」→「未払」に変わって「支払済にする」ボタンが出る
2. `LINE_NOTIFY_DRY_RUN=1` で1グループぶん文面確認
3. **未確認**: 「振込総額」行の 375px 表示（内訳が `A・B級 2名×2,500 / C・D級 3名×2,000 / E級 1名×1,500` まで伸びうる複数行 prewrap。既存の「振込先」行と同じ流儀だが静的照合のみ）
4. CI は pending のままマージ（赤なら追修正）

正典: docs/features/grade-entry-fee/requirements.md / docs/spec/events-attendance.md / docs/spec/notifications.md
