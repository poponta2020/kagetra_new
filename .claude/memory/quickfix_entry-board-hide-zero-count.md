---
name: quickfix-entry-board-hide-zero-count
description: quickfix: entry-board-hide-zero-count
type: project
---

## 修正したバグ
申込管理ボード（/admin/entries）の行で、参加者 0 名の大会にも「（0名）」と人数が表示されていた。0 名時は人数表記そのものを出さない仕様へ変更。

## 根本原因
EntryBoardClient.tsx の EntryRow が attendCount を無条件に「（N名）」として描画していた（表示条件なし）。

## 変更ファイル
- apps/web/src/app/(app)/admin/entries/EntryBoardClient.tsx — attendCount > 0 のときだけ「（N名）」span を描画
- apps/web/src/app/(app)/admin/entries/EntryBoardClient.test.tsx — AC-16 テストを更新（0名の行は「名）」を含まない検証へ）
- docs/features/entry-management/requirements.md — AC-16 に「参加者 0 名の大会は表示しない」を追記（生きた仕様）

## PR
- PR #339 https://github.com/poponta2020/kagetra_new/pull/339
- コミット: 6087da9

## レビュー
auto-review-loop 1R で verdict=pass（effort=medium・Codexトークン20,737/500,000・blockers/should_fix/nits 全て0）。テストは web 116ファイル/1508件 pass、lint/typecheck green。
