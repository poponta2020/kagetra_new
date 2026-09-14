---
name: impl-event-line-broadcast-headcount-breakdown
description: event-line-broadcast ③人数内訳 実装（タスク1-4）
type: project
---

event-line-broadcast の③「グループの人数確認」を役割別の内訳へ改訂した（親 Issue #642 / 子 #643-646）。全4タスクを main 直で直列実装（Wave 編成はせず — タスク1が20行程度で、タスク2の facts 型がタスク3の分岐仕様と密結合だったため委譲オーバーヘッドが上回ると判断）。

## 変更ファイル
- apps/web/src/lib/line-mention.ts(.test) — MentionValue に { text } を追加。差し込み時に中括弧を除去（throw しない）
- apps/web/src/lib/entry-headcount.ts(.test) — loadGroupHeadcountFacts を追加、countGroupEntrants / formatEntrantCountParts / EntryHeadcount を削除
- apps/web/src/lib/entry-headcount-breakdown.ts(.test) — 新規（pure・排他と5分岐）
- apps/web/src/lib/line-mention-targets.ts(.test) — loadPrimaryAdminLineUserIds を追加（loadAdminLineUserIds は不変）
- apps/web/src/lib/line-webhook-handler.ts(.test) — ③の差し替え
- docs/spec/notifications.md・docs/deploy/event-line-broadcast.md・docs/features/line-bot-message-revamp/requirements.md（AC-24 を廃止表記へ）

## ★実装手順書の穴（Advisor 相談のうえ修正）
「排他を適用したうえで副連絡責任者の5分岐を判定する」を字義どおり実装すると、**副連絡責任者を兼ねる管理者がいて遠征届不要の大会**でその人がどの行にも計上されず、合計が実人数より少なくなる（AC-H2 違反）。
→ **遠征届の要否で副連絡責任者バケット自体を空にし**、寄っていない該当者を管理者行へ落とす形に変更。ただし注記の分岐1（全員が上位行へ寄った）は排他の結果で先に判定するので、§3.1.3b の宣言順は保たれる。要件 §3.1.3b に★注記として明記済み。

## 設計上の決定（要件が沈黙していた点）
- 寄せ先が混ざって0名になった行の注記は**バケット優先順位**（大会参加者 ＞ 会計 ＞ 副連絡責任者）で決める
- facts は件数フィールドを持たず entrantUserIds.size を使う（集合との二重管理を避けるため）
- 大会参加者の行は LINE 紐付けで絞らない（既存挙動の維持。§3.1.3a の紐付け条件は役割行にだけかかる。AC-H6 も同様）
- 役割行の母集団にゲスト除外フィルタは足していない（AC-H5 の字義どおり。実運用でゲストにフラグは付かない）

## 注意点
- entry-headcount.test.ts は describe ごとの afterAll(closeTestDb) では動かない（先に終わった describe がプールを閉じ、後続が『Cannot use a pool after calling end on the pool』で全滅する）→ ファイル単位の afterAll 1つに統一した
- worktree: C:/tmp/impl-event-line-broadcast（.env と apps/web/.env.local をメインからコピー、corepack pnpm install 済み）
- origin/main が2コミット遅れていた（要件定義の docs コミットが未 push）ため、worktree を local main へ reset してからブランチを切った → PR 差分に docs コミット2件が含まれる
- ローカル検証: 対象5ファイル 137テスト green・eslint 0件・tsc --noEmit 0件（フルスイートは未実行＝CI に委譲）
