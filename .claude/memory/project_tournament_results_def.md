---
name: project_tournament_results_def
description: tournament-results 機能の要件定義 完了（実データ42件調査・ヘッダ署名駆動パーサ・$0 AI・親Issue#157+子#158-162作成済・実装未着手/implement待ち）
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b951586-8e1f-4fbe-988b-d8e09806a2c7
---

全国大会の結果 Excel（メーリングリスト着）を取り込み、全選手の試合勝敗を DB 保存する機能。要件定義 進行中（2026-06-18 着手）。要件書=`docs/features/tournament-results/requirements.md`。

## 確定方針
- 既存 mail-tournament-import の兄弟。IMAP / 添付 bytea / mail_worker_jobs / レビュー UI を再利用。
- **結果 Excel は標準ツール製で定型** → **決定的パーサで処理、AI 抽出は使わない＝API コスト $0**（ユーザーの無料原則）。当初の毎ファイル AI 案（~$50-150/年）は却下。
- xlsx 読取は脆弱な `xlsx` lib を使わず libreoffice(→CSV/fods) or exceljs（実装時選定）。.xls も libreoffice 変換。
- DB 容量は無問題（最細粒度でも <1GB/10年、200GB に桁違い内側）。自前 Postgres で課金上限なし。
- 大会報告シートは取り込まない。開催日/会場は将来の紐づけ対応（自動化は現状不要）。
- 試合は選手視点 2 行（実データ素直・ロスレス）。v1 閲覧=選手戦績ページ（名前検索）。会員同定は後続。

## データ調査（大会結果=10件＋大会結果2=32件、計42ファイル。`C:\tmp\inspect_results.py <dir> <out>` で解析）
全対戦シートが普遍シグネチャ「選手名＋相手/枚数/勝敗×N回戦」に収束。1行=1選手、各試合は勝者○/敗者×で2回出現、枚数=勝ち枚数差。系統: 対戦結果表(マクロ)/詳報・詳細(派生)/出場者DB(伊助)/兵庫1シート全級/山形・広島の級別シート(列順可変)。

## DB モデル案（旧 contest_* と整合）
tournaments / tournament_classes / tournament_participants(旧 contest_users) / matches(旧 contest_games) / result_drafts(tournament_drafts 踏襲)。正規化単一保持（自会選手の別テーブルは作らない、user_id/所属クエリで抽出）。[[reference_legacy_dump]]

## 設計確定事項（バッチ2解析後）
- **「ヘッダ署名駆動パーサ」1本で全42ファイルの変則を決定的処理可能**＝AI不要・$0 を再確認。列は名前で特定（位置非依存）し列順/ツール差/級の持ち方を吸収。
- 対応するエッジ: 兵庫1シート全級・山形/広島の級別列順可変・大垣(集計+詳細)・小中学生の非AE級(class_name自由文字列)・棄権/不戦勝トークン・○〇正規化・伊助V0.93→V1.10の列差(会員番号追加)・訂正版supersede・署名無しシート自動スキップ。
- matches に status(通常/不戦勝/棄権)、score_diff null可。1ファイルが複数日/級にまたがる(桑名)が日付非取込で影響なし。団体戦は対象外(ユーザー指示)。

## 状態：要件定義 完了（2026-06-19）
- `requirements.md` / `implementation-plan.md` 完了。**親Issue #157 ＋ 子 #158-#162 作成済**。
- PR分割: #158 schema → #159 パーサ中核(最難) → #160 取込ジョブ＋ボタン → #161 レビューUI＋確定保存 → #162 選手戦績ページ。
- **実装は /implement または /do-plan の明示指示待ち（未着手）**。最初は #158 から。

関連: [[project_dev_rules]] [[feedback_dont_rush_requirements_data_first]] [[project_mail_inbox_mailer]]
