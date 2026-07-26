---
name: bug-entry-board-grade-duplicate
description: bug-fix: entry-board-grade-duplicate
type: project
---

申込管理ボード（/admin/entries）の大会表示名が「多摩AA」「鳳玉CDCD」のように級を二重表示するバグの修正。深刻度: 軽微（表示のみ・実装1ファイル+テスト2ファイル）。

**根本原因**: entry-board-utils.ts の displayName が「通称+級」を組み立てる際、通称（tournament_series.short_name）が引けない大会（edition 未紐付け）では title にフォールバックした上でさらに級を連結していた。大会イベントの title は運用上すでに級込みの命名（「多摩A」「鳳玉CD」等。メール承認の unit 分割承認が級込みの名前で events を作る）のため二重になる。本番の申込管理ボード母集団 29 件中 26 件が edition 未紐付けでこの経路に該当（本番 DB を SSH read-only SELECT で実証）。

**修正**: 級の連結は通称が引けたときだけに変更。title フォールバックは title をそのまま表示（title から級文字を剥がすヒューリスティックは「椿杯ABC」等の固有名衝突リスクで不採用）。edition を紐付ければ通称+級表示に自然に戻る（データ整備は別課題）。

**回帰テスト**: apps/web/src/app/(app)/admin/entries/entry-board-utils.test.ts の displayName describe に AC-1 の 2 件（多摩A/{A}→多摩A、鳳玉CD/{C,D}→鳳玉CD）。修正前 fail（鳳玉CDCD を再現）を確認。バグ仕様だった既存期待値 2 件（entry-board-utils.test.ts / page.test.tsx）を変更。web 全体 1508 件 green + typecheck + lint。

**レビュー**: auto-review-loop 1R pass（effort=medium、Codex tokens 31,573、blockers/should_fix/nits 0）。

PR #338: https://github.com/poponta2020/kagetra_new/pull/338 / Issue #335: https://github.com/poponta2020/kagetra_new/issues/335 / requirements: docs/bugs/335-entry-board-grade-duplicate/requirements.md
