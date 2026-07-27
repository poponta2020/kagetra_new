---
name: feature-def-entry-management-round13
description: entry-management round13 改修要件定義（区画名改称・1グループ1行化）
type: project
---

申込管理ボード `/admin/entries` の round 13 リデザインに伴う改修（delta）。親Issue #393 / 子 #394-397。

## 決めたこと
1. **区画名の改称**: 要対応→**要申込** / 申込済み・抽選待ち→**申込完了・抽選待ち** / 名簿確定・振込待ち→**名簿確定・要振込**。理由=「要対応」が何をすべきか伝えていない。**判定条件・並び順・強調条件・内部ID `AreaId` は不変**（変わるのは `AreaDef.label` だけ）。requirements §5 Non-goals の「区画名の変更」を撤回した
2. **1 申込グループ = 常に 1 行**（複数日グループの日別行展開を廃止）。`EntryGroupCard` / `EntryGroupDayRow` / `dayStatusLabel` / `commonDeadlineBadge` を削除。集約規則は2つだけ = 日付は可視日のうちその区画で見る日付が**最早**（並び順キーと同値にして並びと表示を構造で一致させる）、人数は**可視日の合計**
3. **0 件の区画は行動フェーズでも朱にしない**。デザイン過程で出た「0件も淡い朱」案を却下（設計判断12「常時赤くすると赤が背景と化す」を優先）

## ★実装が誤りやすい罠（3つ・すべて要件に明記済み）
- **`/admin/mail-inbox` の tier 0 ラベルも「要対応」**。メール振り分けの tier を指す**無関係な同名**。リポジトリ全体の一括置換は禁止（対象は `admin/entries/` 配下のみ）。回帰 AC-41 を立てた
- **グループ表示名の導出順序**。現行は単独イベント=`displayName()`（通称+級「札幌AB」）、複数日=`group.name`（`events.title` 由来）という不統一。素朴に1行化すると**単独イベントの表示が通称→正式名称へ退行する**。正しい順序 = ①各日の通称ベース名を作る → ②`deriveEntryGroupName` で畳む（杉並B+杉並A→杉並AB）→ ③畳めないときだけ title 由来へフォールバック。AC-16b/16c
- **見出しは `font-bold`(700) 固定。`font-semibold`(600) 不可**。`layout.tsx` が Noto Serif JP を `weight: ['700']` だけで読むため 600 は再現できない。モックは file:// で webfont が読めずフォールバック明朝で描画されるので**この差はモック上では見えない**

## 仕様書の追随漏れも同時に修正
- §3.2.1「`events` 行ごとに1行・集約しない」→ entry-groups タスク6 以降の実態と真逆だったので撤回
- §3.2.2 `hasConfirmedRoster` が `event_id` 基準 → 実装は entry-groups タスク8 で **`entry_group_id` 基準**に移っていた

## 波及した2ファイル
- `docs/spec/events-attendance.md`（正典）— 区画表・行モデル・集約規則・0件の扱い
- `docs/features/entry-groups/requirements.md` — §3.1 と **AC-14 から「日別の進行状態が行で並ぶ」を撤回**（ボード描画仕様の現行正典は entry-management 側だと明記）

## AC / タスク
AC 内訳 = auto-test 47 / verify 0 / manual 3。
Wave 1 = タスク1（entry-board-utils = 共有ホットスポット・単独先行）／Wave 2 = タスク2(page.tsx) + タスク3(EntryBoardClient) 並行（ファイル直交）／Wave 3 = タスク4（忠実度チェックリスト11項目の照合 + grep 検証）。
既存 `entry-board-utils.test.ts` / `EntryBoardClient.test.tsx` は削除対象を検証しているので着手時点で赤くなる（想定内）。

視覚の正 = `docs/features/entry-management/design-spec.md`(round 13・locked) + `design-mock/` の2ファイル。**`design-prototype.patch` は二重に古く適用禁止**。
