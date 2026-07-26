---
name: auto-review-round-pr334
description: auto-review PR #334
type: project
---

PR #334（entry-management / 申込管理ボード）の Codex 自動レビュー記録。

- pr: 334
- rounds: 2
- effort: high 据え置き（差分 4465 行 > 400 で初回から high）
- tokens: R1=192,682 / R2=196,636 / cumulative=389,318 / 500,000
- verdict: R1=needs_changes（blocker 1 / should_fix 1）→ R2=pass（0/0/0）

## R1 の指摘（両方とも実在。修正 commit 6d10556）

1. **[blocker] 畳んだ区画の「ほかN件」が消える** — EntryBoardClient の行一覧が `visible.length > 0` だけで描画を絞っていたため、「締切前」を畳んだときに残す行（締切 3 日以内）が 1 件も無いと `<ul>` ごと描画されず、隠れた件数の表示が消えていた。**締切が全部先＝これが通常の状態**なので、畳んだ区画が完全に無言になる（AC-24 未達）。確定プロトタイプから引き継いだバグで、こちらのテストは固定行が 1 件ある入力しか作っておらず素通ししていた。描画条件に `(!expanded && hiddenCount > 0)` を追加し、固定行 0 件の回帰テストを足した。
2. **[should_fix] 進行状態 3 型の重複定義** — EntryStatus / PaymentType / PaymentStatus を entry-board-utils.ts で再定義していた。**要件 §6 技術的制約が LifecycleStatusBadge.tsx を正典と明記している**ので、type-only import へ変更（コンポーネント本体は実行時に引きずり込まれない）。null の位置も正典に合わせ EntryBoardItem.paymentType を `PaymentType | null` にした。

## 学び

確定プロトタイプのコードは「ユーザーが 12 ラウンド見た」ものでも**境界ケースの分岐は見られていない**（見た目の確認は代表状態でしか行われない）。プロトタイプ由来のロジックにも境界テストを当てること。

## Codex 実行環境の注記

両ラウンドとも Codex 側で Vitest が `spawn EPERM` で起動できず、テストは実行されていない（型チェックのみ）。テストの green は main 側の単独フルスイート実行で担保している。
