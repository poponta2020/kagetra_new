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

## 実装メモ

- 承認専用の既存系列解決は `editionSeriesId` をトランザクション内で `FOR UPDATE` 検証し、名前による暗黙解決と分離した。
- 明示的新規作成でも正準名・aliases の正規化完全一致があれば拒否し、検索結果からの既存系列選択へ戻す。
- 部分承認では、先行イベントに edition がある場合、後続送信の link が OFF でも同じ edition を継承する。逆順（後から link ON）の backfill と合わせて draft 内を同一 edition に収束させる。
- UI 検索は「系列名／別名が検索語を含む」方向だけの部分一致とし、自動解決用の保守的な双方向包含スコアとは分離した。
- 承認フォームは検索語・既存系列ID・新規作成確認を別状態で保持し、既存の portal + `.modal-overlay-h` + `min-h-0` ボトムシート構造を再利用した。
- 375×812 の実ブラウザ確認ではシート幅360px、横スクロールなし、候補領域 `overflow-y:auto`、フッターの確定ボタンが画面内（bottom 796px / viewport 812px）。既存選択・解除・0件・新規確認・回次修正を完了できた。
