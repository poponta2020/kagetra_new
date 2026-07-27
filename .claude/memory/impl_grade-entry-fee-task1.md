---
name: impl-grade-entry-fee-task1
description: grade-entry-fee タスク1
type: project
---

タスク1: 級別参加料の定数と参照関数を packages/shared に追加（完了・コミット 6f2dd0f）

## 実装内容
- 新規 `packages/shared/src/constants/entry-fee.ts`
  - `OFFICIAL_ENTRY_FEE_JPY: Record<Grade, number>` = { A:2500, B:2500, C:2000, D:2000, E:1500 }
  - `officialEntryFeeJpy(grade: Grade | null | undefined): number | null`
- 新規 `packages/shared/src/constants/index.ts`（re-export）
- 変更 `packages/shared/src/index.ts`（`export * from "./constants"` の1行。types と schema の間に挿入）
- 新規 `packages/shared/__tests__/entry-fee.test.ts`（7件）

## 実装中に判明した注意点（重要）
**継承プロパティの取りこぼし**: `OFFICIAL_ENTRY_FEE_JPY[grade] ?? null` という素直な実装だと、
`grade` に `"toString"` や `"constructor"` が来たとき Object.prototype のメソッドが引けてしまい、
`?? null` をすり抜けて**関数が返る**。`Object.prototype.hasOwnProperty.call` で自前キーだけを見るよう修正。
テストで先に検出（`does not resolve inherited Object properties as grades`）。
DB 由来の文字列を型 `Grade` として受ける関数では今後も同じ罠がある。

## 検証結果（worktree で main が直列実行）
- `pnpm --filter=@kagetra/shared test` → 36 passed（新規7 + 既存29）。既存に影響なし
- `pnpm --filter=@kagetra/shared check-types` → 通過
- worktree は node_modules が無い状態で作られるため `corepack pnpm install` が先に必要だった（58秒）

## 委譲
なし（main 直実装）。数ファイル追加の小径タスクで、task-implementer 起動のオーバーヘッドの方が高いと判断。

## Wave 構成
単一タスク・Wave 1のみ（並行なし）。

## worktree
`C:/tmp/impl-grade-entry-fee`（ブランチ `feature/grade-entry-fee`・push 済み）
