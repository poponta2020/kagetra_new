---
name: ship-entry-board-round13
description: 申込管理ボード round 13（改称・1グループ1行化・ビジュアル移植）
type: project
---

PR #398 — feat(entry-board): 申込管理ボードの区画名改称・1グループ1行化・round 13 リデザイン移植
https://github.com/poponta2020/kagetra_new/pull/398 — **MERGED**（merge commit 62fddd1）

親 Issue #393 クローズ。子 Issue #394〜#397 は PR 本文の closing keyword で自動クローズ。

## 何を出したか

`/admin/entries` 申込管理ボードの round 13 改修。**判定条件・母集団・並び順キー・強調の発火条件は 1 つも変えていない**（表示文字列・行モデル・見た目だけ）。

- 区画名の改称 3 件: 要対応→**要申込** / 申込済み・抽選待ち→**申込完了・抽選待ち** / 名簿確定・振込待ち→**名簿確定・要振込**。`AreaId`（action_required 等）は意図的に不変＝entry-overdue-alert との対応関係と既存テスト参照を壊さない
- **複数日グループの日別展開を廃止し 1 グループ = 常に 1 行**（設計判断18）。EntryGroupCard / EntryGroupDayRow / dayStatusLabel / commonDeadlineBadge を削除
- 集約規則を純関数化: 日付・残日数＝可視日のうちその区画で見る日付が最も早いもの、人数＝可視日の合計
- グループ表示名を通称ベースで導出（通称+級を作ってから畳む）。1 行化で単独イベントが正式名称へ退行するのを防ぐ
- round 13 のビジュアル移植（明朝15px藍の見出し／常時 bg-surface の面／玉を見出し行内・常に13px／divide-y 撤去／レール線を最初の玉の中心から最終行まで／0件は行動フェーズでもグレー）

## 設計上の要点（後で読む人向け）

- **groupSortKey と groupDeadlineBadge を両方 pickRepresentativeDay 経由に統一した**。並び順キーと画面の日付が構造的に同じ日から出ることを保証するため（AC-37）。別々に最小値を取ると実装が少しずれた瞬間に「並びと表示が食い違うボード」になる
- **sortGroupsInArea の副キーは minEventDate（可視日の最小開催日）のまま維持**。代表日（＝最も早い締切の日）の開催日へ寄せると、キー同値時の並びが静かに変わって AC-15 / AC-31c が壊れる。判別できる回帰テストで固定した
- **displayName() は削除せず引数型を NameSource へ広げて page.tsx から再利用**した。単独イベントの表示名が改修前と1文字も変わらないこと（AC-16b）を「同じ関数を通す」構造で保証するため
- **表示名の導出母集団はグループの全イベント／人数・日付の集約母集団は可視日のみ**という意図的なズレ。テストで固定済み
- entry-board-utils.ts は client component から import されるため `@/lib/entry-groups`（DB層）を import しない、という既存制約は維持

## 検証

- entries 3ファイル **136 tests green** / `pnpm check-types` green / `pnpm lint` green
- **CI（Lint/Typecheck/Test）は pending のままマージ**（v0.9.0 方針）。赤くなったら /quickfix で追修正する
- DoD ゲート: 全項目 PASS（A4 のみ WARN＝ローカル HEAD が PR HEAD と異なるが A 項目は全て CI 委譲/SKIP のため影響なし）

## Codex レビュー

**1 ラウンドで pass**（構成: initial のみ・final は省略）。gpt-5.6-sol / effort=medium（review-effort.sh は「差分2186行>400」で high を返したが、高リスクパス起因ではなくサイズ起因なので initial の sol 較正で一段下げた）。blockers 0 / should_fix 0 / nits 0・171,965 tokens。**打ち切りは発生しておらず、未再レビューの差分は無い**。

## ★残 DoD（本番実機・ユーザーが実施）

- **AC-32 / AC-42**: 本番で 375px の1画面に5区画が収まること、design-spec §8 忠実度チェックリスト全項目を満たすこと
- ローカル 375px 実測は**実施していない**（in-app Browser が file:// を CSP付きスナップショット化して JS 実行を止め、localhost の任意ポートも policy でブロック）。ユーザー判断で実画面確認は本番でまとめて行う方針にした
- 特に確認したい 4 点: ①玉中心とレール中心の一致 ②レール線が最初の玉の中心から始まり最終行まで伸びる ③区画ヒントと日付列の右端の一致 ④縦横スクロールが出ないこと
- 算術の導出式は docs/features/entry-management/design-spec.md §9 の「実装時の照合結果」に記録済み
