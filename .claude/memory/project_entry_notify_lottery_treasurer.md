---
name: entry-notify-lottery-treasurer-defined
description: entry-notify-lottery-treasurer 機能定義完了 (2026-06-04)。申込完了通知に抽選日(参加者)＋振込方法/期限(会計2通目)を追加。要件+計画+Issue
metadata: 
  node_type: memory
  type: project
  originSessionId: fc3dab67-b314-43df-84ee-2b0db1d689c0
---

# entry-notify-lottery-treasurer 機能定義完了 (2026-06-04)

[[event-lifecycle-notify-defined]] / [[impl_event_lifecycle_notify]] の延長。申込完了（`setEntryApplied(true)` 初回遷移）時に、紐付け済み参加者 LINE グループへ **2 通** 送る。**要件定義・実装計画・Issue まで完了、実装は未着手**。

**Why:** 申込が通ると参加者は「抽選はいつか」を、会計は「どう・いつまでに振り込むか」を知りたいが、今は口頭/手動連絡で漏れる。振込情報(payment_method/payment_info/payment_deadline/fee_jpy)は既に events にあるが、抽選日カラムが無かった。

**How to apply:** 実装は `/implement entry-notify-lottery-treasurer`。詳細は `docs/features/entry-notify-lottery-treasurer/requirements.md` と `implementation-plan.md`（リポジトリ内が正）。

## 確定した非自明な設計判断（ユーザー回答ベース）
- **会計は新ロール/新経路を作らず、同じ参加者グループへ同送**（「会計の方へ」と呼びかける 2 通目）。system_notify 個人 LINE や Web Push、会計ロール追加はいずれも不採用。
- **2 通に分割**（1 通統合にしない）。参加者向け=既存 `entry_applied` を抽選日追記で拡張、会計向け=**新 enum 種別 `entry_applied_treasurer`**。種別ごとに `(event_id,type)` once-ever。両方を `setEntryApplied` の同一 tx で claim → コミット後に 2 回 push（best-effort、既存パターン踏襲）。
- **会計向けは payment_type で出し分けず常に送る**（現地払い/未設定でも）。内容は **振込方法＋振込期限のみ。金額(fee_jpy)は載せない**（会計は合計を振込むため 1 人あたり額は誤解の元）。3 項目すべて空なら最小文面。
- **抽選日 = events.lottery_date を新設し手動入力**（編集フォームに date 入力 1 つ）。**AI 自動抽出は今回やらない**。
- **スコープ外**: 抽選「結果」(通過/落選)通知、AI 抽出、会計専用ロール/チャネル、金額併記、締切リマインドへの会計文面追加。

## 並行作業の衝突回避（重要・開発ルール11）
- `feature/tournament-title-split`（worktree `C:/tmp/impl-tournament-title-split`、全7タスク実装完了・PR前 commit 754db15）が AI 抽出 `apps/mail-worker/src/classify/{schema.ts,prompt.ts}` を**単一オブジェクト→`events[]` 配列形へ破壊的に作り替え中**(PROMPT_VERSION 2.0.0)。
- 本 PR は **AI 抽出を一切触らない**ことでブロッキング衝突を回避。**抽選日の AI 抽出は title-split マージ後の別 follow-up**（新 `EventUnitSchema` に `lottery_date` 追加＋プロンプト調整）。
- 残る共有ファイルの軽微衝突は **rebase で吸収（Claude 側）**: `events.ts`(双方カラム追加)・migration `_journal.json`/snapshot(番号衝突, 現状 main 0018 → 本 PR 0019 想定だが title-split マージ後に再採番)・`form-schemas.ts`(双方改修)。
- main から分岐、worktree は `C:/tmp/...` 明示作成。title-split が先にマージ見込み → マージ前に main へ rebase。

## Issue
親 #112 / 子 #113 DB+migration・#114 文面テンプレ(lib)・#115 申込完了 server action 2通化・#116 抽選日入力(フォーム/保存/参照)・#117 E2E。実装順: 113 → 114 → 115・(116) → 117。
