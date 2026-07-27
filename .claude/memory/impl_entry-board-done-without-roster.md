---
name: impl-entry-board-done-without-roster
description: entry-management 改修: 確定名簿を「完了」の必須要件から外す
type: project
---

申込管理ボード `/admin/entries` の `classify` から「完了」の確定名簿要件を外した（Issue #379・PR未作成時点でブランチ feature/entry-board-done-without-roster / commit a524061）。

## 変更内容
- `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts` — `applied` 分岐を「支払い決着 → 名簿なし → 振込待ち」の評価順に組み替え。判定は反転させていないので戻すのは git revert だけで済む
  - `if (item.paymentType !== 'advance' || item.paymentStatus === 'paid') return 'done'` を先頭に置く
  - `AreaId.applied_waiting` の JSDoc を新しい母集団（事前払い・未振込・名簿待ち）へ更新。`classify` の JSDoc も「評価順は可読性のためだけ」が偽になったので修正
- テスト: entry-board-utils.test.ts（AC-12b/12c/13b・網羅入力に名簿なし3ケース追加・グループ内で done と applied_waiting が混在する境界1本）/ EntryBoardClient.test.tsx（抽選待ちを狙う3箇所に advance+unpaid を明示）/ page.test.tsx（AC-13 の2フィクスチャに advance+unpaid、AC-12b のDB統合テスト追加）

## 検証（worktree で main が直列実行）
- `pnpm --filter=@kagetra/web test -- --no-file-parallelism`: 137 files / 1945 passed / 1 skipped
- `pnpm check-types` / `pnpm lint`: 通過
- `entry-flow.test.ts` は無変更のまま green（AC-31b の回帰証拠）

## 注意点
- `PaymentStatus` は TS union も DB enum も `'unpaid' | 'paid'` の2値ちょうど。3値目があると `=== 'paid'` で挙動が変わるので、拡張時はこの分岐を見直すこと
- `docs/spec/events-attendance.md` は要件定義コミット(4d9725f)で既に新仕様へ更新済み。実装側の docs 追随は不要だった
- **worktree `C:/tmp/impl-entry-management` は git 管理外の残骸**（.git 無し・node_modules 込み）。ensure-worktree.sh が 'already exists' で落ちるため、今回は別 slug `impl-entry-board-done-without-roster` で作成した。掃除は未実施
- ブランチはローカル main (4d9725f = origin 未push の要件定義コミット) から切ったので、PR 差分に要件定義コミットが含まれる

## worktree
C:/tmp/impl-entry-board-done-without-roster
