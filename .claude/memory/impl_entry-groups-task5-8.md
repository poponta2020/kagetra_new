---
name: impl-entry-groups-task5-8
description: entry-groups 全8タスク完了(PR前)
type: project
---

entry-groups（親Issue #359）**全8タスク実装完了**。ブランチ `feature/entry-groups`・11コミット（d3ea0e3〜d09cb3d）push 済み・**PR 未作成**。前提の詳細は [[impl-entry-groups-task1]] 〜 [[impl-entry-groups-task4]]。

## タスク5-8 の要点
- **#364 タスク5** (0bc3c4e): 締切リマインドを (グループ, 種別, 締切日) 1通へ・overdue をグループ1行へ
- **#365 タスク6** (997684e): /admin/entries を1グループ=1カードへ
- **#366 タスク7** (adacb8b): 承認フォームの自動グループ提案（group_key）
- **#367 タスク8** (b763105): 名簿をグループ帰属へ + **migration 0048/0049** + lottery を EXISTS へ
- docs (d09cb3d): events-attendance / notifications / tournaments-results を正典更新

## ★★最重要の学び: CI は `build` を回していない
`.github/workflows/ci.yml` は lint / check-types / test / e2e のみ。**client バンドル汚染は CI で捕まらずデプロイまで出ない。**
- `@/lib/entry-groups` は `@kagetra/shared/schema` と drizzle を**値** import する（DB 層）。`'use client'` から import するとスキーマがクライアントバンドルへ載る
- タスク6 のワーカーは自力で気づいて回避（サーバーで導出して平らな値を渡す）。タスク7 は ApprovalForm から直接 import していたので、main が純関数を **`lib/entry-group-cluster.ts`（DB 非依存 leaf）**へ切り出して解消
- **UI を触る PR では必ずローカルで `pnpm --filter=@kagetra/web build` を回し `✓ Compiled successfully` を確認する**（Windows では standalone コピー段で EPERM が出るがコード起因ではない。`Module not found` / `Can't resolve` が0件かを見る）

## migration 番号の実績（計画は3本→実績5本）
`drizzle-kit generate` の rename プロンプト回避で FK 列の付け替えは必ず2パスになる（[[drizzle-generate-rename-prompt]]）:
| 実績 | 内容 |
|---|---|
| 0045 | events.entry_group_id + クラスタ backfill（**手修正**） |
| 0046 / 0047 | LINE: 新列ADD+backfill+ガード（**手修正**） / 旧列DROP |
| 0048 / 0049 | 名簿: 同上（**手修正**） / 旧列DROP |
**手修正版（0045/0046/0048）は `db:generate` で上書きしないこと。**

## scratch DB で実測した migration 検証（vitest では走らないため唯一の手段）
`kagetra_migtest`（0049 まで適用済みで残置）:
- 0045: 多摩5件→2グループ・秋田2件→2グループ・NULL締切2件→1グループ・draft無し→各singleton・取りこぼし0
- 0046/0047: 多摩A の linked 紐付け→多摩A+B グループ / 多摩C の紐付け→C+D+E グループ・revoked 履歴保全・Bot 予約移行・旧列0件（**AC-7**）
- 0048/0049: 多摩C の名簿→C+D+E グループ帰属（D/E からも同一名簿）・旧列0件

## その他の引き継ぎ
- **`line-broadcast.test.ts` は `truncateAll` を使わず自前の削除リストを持つ。** テストファイルが増えて実行順が変わると FK 違反で落ちる（今回13件失敗）。参照元（line_grade_group_bindings / event_grade_broadcasts）を先に消す順序へ修正済み
- **worktree のテスト DB が旧スキーマで残ると `drizzle-kit push --force` が非対話プロンプトで詰まる。** テスト DB を DROP して作り直せば解消（複数のワーカーが同じ現象を踏んだ）
- lottery は `EXISTS` 書き換えのみ。**`edition_id` を roster へ非正規化してはならない**（承認フローが後から edition を紐付けるので stale になる）
- `mail-worker/src/roster-import/coverage-report.ts` は raw SQL で `roster.event_id` を参照していた（型チェックで検知できず実行時に壊れる）。タスク8 で EXISTS 化済み

## 検証（最終）
web **1921 passed / 137 files**・mail-worker **456 passed / 40 files**・shared **29 passed / 5 files**・
`pnpm check-types` 4/4 successful・`pnpm lint` clean・`next build` の Compiled successfully を確認。

## 残（次アクション）
**PR 作成 → Codex レビュー → ship。** AC-24 のみ manual（本番で複数日大会1件について LINE紐付け1回→一括申込済→通知1通+会計1通を実機確認）= **出荷後の残 DoD**。
