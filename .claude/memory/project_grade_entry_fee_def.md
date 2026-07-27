---
name: feature-def-grade-entry-fee
description: grade-entry-fee 要件定義
type: project
---

機能名: grade-entry-fee（親Issue #390 / 子Issue #391）

## 何を作るか
公認大会の級別参加料（全日協規定: A/B 2,500円・C/D 2,000円・E 1,500円）を packages/shared の
定数として保持するだけ。**UI 変更ゼロ・マイグレーションなし・消費側の配線なし**。

- `packages/shared/src/constants/entry-fee.ts` に `OFFICIAL_ENTRY_FEE_JPY: Record<Grade, number>` と
  `officialEntryFeeJpy(grade): number | null`
- テストは `packages/shared/__tests__/entry-fee.test.ts`（vitest.config.ts の include が `__tests__/**` のためコロケート不可）
- 既存ファイルの変更は `src/index.ts` の `export * from "./constants"` 1行のみ

## 主要な設計判断と理由
- **級別カラム追加（fee_jpy_a..e）を却下し定数へ**: 実額は A・B / C・D / E の3段階で全国一律の協会規定。
  イベントごとに入力させる情報ではなく、改定時の変更点も1箇所で済む
- **settings テーブルでなく TS 定数**: 会ごとに変える値ではない。DB に置くと出典と施行日を追えなくなる。
  entry-form-autofill が settings 新設を計画中だが、協会規定値は会の設定ではないので家を分ける
- **未知の級は null を返す（0 や既定額に倒さない）**: users.grade は nullable。既定額へ倒すと
  級未設定の会員に誤った金額が静かに伝播する
- **UI を今回のスコープから切り離した（ユーザー指示）**: 表示に手を入れると feeJpy=null の既存イベントに
  一斉に金額が出る＝公開済みデータの見え方が変わる。値の保持と段階を分けた。
  official 判定・`feeJpy ?? derived`・「規定額」ラベル・会員ごと算出は**表示回の論点として持ち越し**
  （方向性は project_grade_fee_derivation_direction.md に記録済み）
- **初段認定大会は E級と同値で扱う（ユーザー選択）**: 1,500円で同額。ただし根拠は別通達
  （member-download/3507）なので、片方だけ改定されたら独立キーへ分ける旨をコメントに残す

## Acceptance Criteria
全5件・**すべて auto-test**（verify 0 / manual 0）。AC-1 5級の金額 / AC-2 null・undefined・未知値で null /
AC-3 Grade に網羅的で級の増減が型エラー / AC-4 ルートエントリから import 可 / AC-5 既存 CI green

## タスク構成
タスク1のみ・Wave 1（単一・直列）。依存なし。

## 付随して判明した既存ドキュメントの誤り（未修正・スコープ外）
docs/features/entry-form-autofill/requirements.md:72 の「級別人数・参加費集計は COUNTIF/SUM が既にある」は
参加費部分が誤り。公式統一申込書テンプレートの集計は級別**人数**の COUNTIF と SUM のみで、単価も金額の式も無い
（xlsx を実際に解析して確認）。未着手機能の生きた仕様書なので要修正。
