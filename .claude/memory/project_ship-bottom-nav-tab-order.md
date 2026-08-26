---
name: ship-bottom-nav-tab-order
description: fix(web): ボトムナビの並び順を ホーム/大会/申込管理/統計/メール/設定 に変更
type: project
---

ボトムナビの並び順変更（/quickfix 直接依頼・Issue なし）。PR #544 https://github.com/poponta2020/kagetra_new/pull/544 をマージ済み。

- **修正内容**: ボトムナビの並びを「ホーム/大会/統計/申込管理/メール/設定」→「ホーム/大会/申込管理/統計/メール/設定」へ（統計と申込管理を入れ替え）。ユーザー指定の並び。
- **原因/変更箇所**: 並びは bottom-nav.tsx の TABS 配列ハードコードで決まる。entries と players のエントリ入れ替えのみで、href・active 判定・role 分岐・ゲスト表示（大会/設定2タブ）は不変。
- **変更ファイル**: apps/web/src/components/layout/bottom-nav.tsx（TABS 入れ替え+コメント追随）/ bottom-nav.test.tsx（順序検証2件+href一覧の期待値）/ docs/spec/ui-shell.md（タブ構成テーブルの行順。★同テーブルの events ラベルが呼称統一 PR #512 前の「イベント」のままだったのを「大会」へ事実修正）
- **コミット**: 94863a5
- **テスト**: worktree で bottom-nav / mobile-shell / (app)/layout の 53 テスト green。
- **レビュー**: auto-review-loop 1R(initial のみ・sol/low)で verdict=pass（blockers/should_fix/nits すべて0）。累計 62,285 tokens。final 省略（R1 が最終形を確認済み）。
- **残DoD**: CI pending のままマージ（赤なら追修正）。本番実機での表示順確認は出荷後。
