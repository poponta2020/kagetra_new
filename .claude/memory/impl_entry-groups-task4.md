---
name: impl-entry-groups-task4
description: entry-groups タスク4完了(残4)
type: project
---

entry-groups（親Issue #359）**タスク4 完了**。commit 79ec9a3（push 済み）。**タスク1-4 完了 / Wave5（#364/#365/#366）実装中 / #367 残り。**

## タスク4（#363）で入ったもの
- bulk action 新設: `setEntriesApplied(eventIds, applied)` / `setPaymentsPaid` / `setPaymentTypes`。既存の単一 action は `bulk([eventId], ...)` への薄いラッパーへ縮退
- `buildLifecycleMessage` に複数日拡張（`days: LifecycleDayEntry[]`）。`sendClaimedNotificationBulk`（1回の push 結果を複数 claim へ finalize）も追加
- `GroupToggleDialog`（一括選択ダイアログ）と `GroupDayLinks`（AC-16 日リンク）を `components/events/detail/` に新設

## ★引き継ぐべき設計判断
1. **once-ever は (event_id, type) のまま**。一括操作は「N 件 claim して claim できた集合で1通作る」形。これで AC-9（後から日を追加したとき新規分だけ通知）が仕組みとして出る
2. **N=1 は既存コードパスに一切入らない設計**（`days` を渡さずスカラー引数のみ）。**既存 `lifecycle-actions.test.ts` を1行も編集せずに green** = 現行文面とバイト互換であることの担保。ここを崩すと文面が変わる
3. **3つの bulk action すべて対象 id を昇順ソート**（逆順ロックのデッドロック回避）
4. **更新対象は UPDATE の WHERE に `entry_group_id = ?` を含めて DB レベルで再検証**（クライアントが他グループの id を混ぜても更新されない）。タスク2 の伝播と同じフェイルクローズ形
5. **`cancelled` は claim ループ直前で tx 内再ガードして通知対象から除外**。状態変更そのものは記録する（既存の「cancelled には送らないが記録はする」と対称）
6. **複数日ラベルは `formatEventDate(date) + title`**。要件の例「8/1(土)C級」が title 由来か eligibleGrades 由来か一意に決まらないため、常に存在する title を採用（eligibleGrades は null/複数を取りうる）。**要件 Non-goals が「通知文面の刷新はしない」なので最小変更に寄せた判断**
7. `payment_paid` の複数日文面は日別ラベル列挙のみ（全日同値/日別の出し分けを要件が明示しているのは `entry_applied_treasurer` の payment 系だけ）

## 検証（タスク4 時点）
Vitest **1877 passed / 1 skipped（137 files 全green）**・check-types pass・eslint clean。
新規: `actions.bulk-lifecycle.test.ts`(7・AC-8/9/10/11＋未linked skipped＋グループ外idフェイルクローズ)・`GroupDayLinks.test.tsx`(3)・`event-lifecycle-notify.test.ts` に複数日8件＋bulk finalize 1件。

## 残り
Wave5=#364 タスク5（リマインダー集約）/ #365 タスク6（ボードのグループカード化）/ #366 タスク7（承認フォームのグループ提案）を**並行実装中**（変更領域が互いに素。共有ホットスポット `lib/entry-groups.ts` は変更禁止と指示済み）。
→ Wave6=#367 タスク8（名簿 + **migration 0048/0049** + lottery 回帰）。**PR は1本。**
