---
name: feature-def-tournament-entry-rosters-series-search
description: メール承認画面の系列検索 要件定義
type: project
---

## 機能

大会ライフサイクル基盤（edition）: メール承認画面の系列検索。

## 主要な要件判断

- 承認画面で既存系列180件を正準名・aliasesから正規化部分一致検索する。
- 完全一致が1件のときだけ初期選択し、曖昧・未一致は検索語のみで未選択にする。
- 検索語と選択済み系列を分離し、既存系列はIDで確定する。
- 新規系列は名称入力と管理者の明示確認がある場合だけ作成する。
- 結果取込側UX、DBスキーマ、既存データ移行は対象外。
- ユーザー指定によりdesign-screenは省略し、既存検索ボトムシートのUIパターンを踏襲する。

## 技術計画

- 全系列とAI初期候補を1回のDB読み取りから組み立て、検索はクライアント側で行う。
- DB非依存の検索ロジックを `apps/web/src/lib/edition/` 配下へ分離する。
- `approveDraftUnits` は既存系列IDをトランザクション内で存在・kind再検証し、新規作成経路だけ名前名寄せを使う。
- 2タスク2Waveの直列構成。Wave 1が検索・ID契約、Wave 2が承認UI・正典仕様更新。

## Acceptance Criteria

11件: auto-test 10件 / verify 1件 / manual 0件。

## GitHub Issue

- 親 #289: https://github.com/poponta2020/kagetra_new/issues/289
- 子 #290: 系列検索ロジックとID選択契約を整備する
- 子 #291: 承認フォームへ系列検索・選択UIを組み込む

## 成果物

- `docs/features/tournament-entry-rosters/requirements.md`
- `docs/features/tournament-entry-rosters/implementation-plan.md`
