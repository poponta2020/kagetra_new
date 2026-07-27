---
status: completed
---

# grade-entry-fee 実装手順書

## 技術設計

- **置き場所**: `packages/shared/src/constants/entry-fee.ts`（新規 `constants/` ディレクトリ）
  - 既存の `types/` はディレクトリ単位で `index.ts` 経由 re-export。同じ形に揃える
  - `packages/shared/src/index.ts` に `export * from './constants'` を追加（AC-4）
  - `package.json` の `exports` に `./constants` を足す必要は**ない**（ルート `.` から引ければ AC-4 を満たす）
- **型**: 既存の `Grade`（`packages/shared/src/types/index.ts:4`）を使う。新規の級型は作らない
  - `Record<Grade, number>` で網羅性を型に強制（AC-3）
- **API**:
  - `OFFICIAL_ENTRY_FEE_JPY: Record<Grade, number>` — 定数テーブル
  - `officialEntryFeeJpy(grade: Grade | null | undefined): number | null` — 引けなければ `null`（AC-2）
    - 実装は `grade == null ? null : (OFFICIAL_ENTRY_FEE_JPY[grade] ?? null)`。
      DB 由来の未知文字列が来ても実行時に `null` へ倒れる（型は Grade だがランタイムは信用しない）
- **テスト**: `packages/shared/__tests__/entry-fee.test.ts`
  - `vitest.config.ts` の `include` が `__tests__/**/*.test.ts` のため**コロケートしない**（既存 5 テストと同じ置き方）
- **マイグレーションなし・UI 変更なし・既存ファイルの変更は `src/index.ts` の 1 行のみ**

## 実装タスク

### タスク1: 級別参加料の定数と参照関数を packages/shared に追加

- [x] 完了
- **目的:** 協会規定の級別参加料を出典付きで1箇所に保持し、級から金額を引けるようにする
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5
- **主な変更領域:**
  - 新規 `packages/shared/src/constants/entry-fee.ts`
  - 新規 `packages/shared/src/constants/index.ts`
  - 新規 `packages/shared/__tests__/entry-fee.test.ts`
  - 変更 `packages/shared/src/index.ts`（`export * from './constants'` の 1 行追加）
- **依存タスク:** なし
- **必要なテスト（テストファースト）:**
  - 5 級すべての金額（AC-1）
  - `null` / `undefined` / 未知文字列（`'F' as Grade`）で `null` が返る。**`0` や既定額を返さないことを明示的に assert**（AC-2）
  - `Object.keys(OFFICIAL_ENTRY_FEE_JPY)` が `['A','B','C','D','E']` と一致（AC-3 の実行時側。型側は `Record<Grade, number>` が担保）
  - `@kagetra/shared` のルートエントリ（`../src/index`）から両方 import できる（AC-4）
- **完了条件:** `pnpm --filter @kagetra/shared test` green / `check-types` 通過 / 既存テストに影響なし
- **コメントに残す出典:** 全日協「公認大会の参加料・公認料の改正について」2021-04-28 発出・**2021-07-01 施行**、
  会員ページ `member-document/2187` 添付 `member-download/2178`。
  初段認定大会も 1,500 円だが根拠は別通達（`member-download/3507`）で、片方だけ改定されたら独立キーへ分ける旨も併記
- **対応Issue:** #391（親 #390）

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1（単一タスク・直列）
