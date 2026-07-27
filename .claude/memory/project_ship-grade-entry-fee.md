---
name: ship-grade-entry-fee
description: 公認大会の級別参加料を定数として保持
type: project
---

PR #392「feat(shared): 公認大会の級別参加料を定数として保持」
https://github.com/poponta2020/kagetra_new/pull/392

## 出荷内容
全日本かるた協会が定める公認大会の級別参加料を packages/shared の定数として保持。
**UI 変更ゼロ・マイグレーションなし・消費側の配線なし**の純粋な追加（250行追加/削除0）。

| 級 | 参加料 |
|---|---|
| A | 2,500円 |
| B | 2,500円 |
| C | 2,000円 |
| D | 2,000円 |
| E | 1,500円 |

- `packages/shared/src/constants/entry-fee.ts`（新規）: `OFFICIAL_ENTRY_FEE_JPY: Record<Grade, number>` と
  `officialEntryFeeJpy(grade: Grade | null | undefined): number | null`
- `packages/shared/src/constants/index.ts`（新規）/ `src/index.ts` に1行追加
- `packages/shared/__tests__/entry-fee.test.ts`（新規・7件）

## 設計判断
- **級別カラム（fee_jpy_a..e）を却下し定数へ**: 実額は A・B / C・D / E の3段階で全国一律の協会規定。
  イベントごとに入力させる情報ではなく、改定時の変更点も1箇所で済む
- **0 と null を厳密に区別**: 参加費の 0 は「無料大会」の意味。級を引けなかったときに 0 や既定額へ倒さない
  （`users.grade` は nullable）
- **継承プロパティの罠**: `OFFICIAL_ENTRY_FEE_JPY[grade] ?? null` だと grade="toString" 等で
  Object.prototype のメソッドが引けて `?? null` をすり抜け関数が返る。`hasOwnProperty.call` で防いだ。
  DB 由来文字列を型 Grade として受ける関数では今後も同じ罠がある
- 初段認定大会（1,500円）は E級に寄せた（ユーザー選択）。根拠は別通達なので片方だけ改定されたら独立キーへ

## クローズした Issue
- #391（子・タスク1）/ #390（親）— いずれも PR 本文の closing keyword でマージ時にクローズ

## レビュー（auto-review-loop がラウンド記録を省略した 1R pass のため、ここに集約）
- Codex 1 ラウンド・effort=medium・verdict=**pass**（blockers 0 / should_fix 0 / nits 0）
- 累計トークン 103,002 / 500,000
- 評価点: Record<Grade, number> による網羅性の型検査 / hasOwnProperty による未知値・継承プロパティの拒否 /
  取得不能時に 0 でなく null を返す仕様が実装とテスト両方で明示されている
- Codex 側は sandbox の spawn EPERM で Vitest 未実行。実装時に main が worktree で実行済み
  （`pnpm --filter=@kagetra/shared test` = 36 passed / `check-types` 通過）

## AC 充足
全5件 auto-test。AC-1〜AC-4 はテスト green で充足。AC-5（既存 CI green）は web・mail-worker のスイートを
CI に委譲。**CI pending のままマージ**（v0.9.0 方針）。赤くなったら追修正。

## 残タスク
表示側（official 判定・`feeJpy ?? derived`・「規定額」ラベル・会員ごと算出）は意図的に持ち越し。
方向性は project_grade_fee_derivation_direction.md に記録済み。要件定義は未実施。
