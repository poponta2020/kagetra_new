---
name: project_individual_coverage_audit
description: 個人戦結果カバレッジ調査(2010-2026)。会員ページharvestは完全と実証・欠落は順位戦/PDF/団体/no_result/中止に分解・選抜大会16回が最大回収候補。成果物=REPORT+series_coverage.csv
metadata: 
  node_type: memory
  type: project
  originSessionId: d1f534e8-85ad-447f-b01b-bbf4a845dc39
---

2010-2026の競技かるた**個人戦**について「各シリーズ第何回〜第何回開催され、結果を取り込めているか/なぜ無いか」を、HP一次情報(会員ページ)軸で調査した（2026-06-26）。**既存DBは変更せず**集計のみ（ユーザー指示）。

## 確定した重要事実
- **会員ページharvestは完全（実地検証）**: 静的2010-2021はライブ年ページ行数=既harvest plan.csv行数が全年完全一致(2018:135=135,2019:147,2020:143,2021:175)。新WP2022-2026はライブcup-info **781**≒harvest **780**。→ **会員ページからの再取得(再harvest)は不要**。ユーザー仮説「harvest漏れ」はほぼ否定。
- **大阪103回はHPにも存在しない**（102=2022.01→104=2022.10の番号スキップ、2022全203投稿走査で確認）。**女流50回**はHPにあるがHP側誤記「★第50全国…女流」(回脱字)で当方が落としていた正規化アーティファクト=修正済。
- **欠落理由の内訳(個人戦・全合算)**: 特殊形式/未取込100・no_result(HPに結果ファイル無)94・HP掲載なし80・PDF/Word 46・中止35。団体戦17系統は別データモデルでスコープ外。
- **最大の回収候補=選抜大会(全国選抜, 第26-41回, 取込0/16)**: 結果Excelは harvest 済だが**順位戦(総当たり)形式**でパーサが「優勝回数集計シート」だけ拾い対戦未取込（サイレント欠落。前セッションSKIP_DIAG監査=パース0の真欠落3件には出ない）。**HP不要、順位戦パーサ追加で回収可**。
- 「特殊形式/未取込100」は (a)選抜等の順位戦真欠落 (b)級偏在 (c)その回だけ表記揺れの照合漏れ の混在(要ファイル単位再検証)。桑名71等は実欠を確認。

## 成果物（git外 c:/tmp）
- `c:/tmp/REPORT_individual_coverage_2010_2026.md` … 本体レポート(カテゴリ別 第X〜Y回 表+理由)
- `c:/tmp/series_coverage.csv` … 全シリーズ×回次明細(status/hp_filetypes/in_corpus/生名)、`series_coverage_summary.txt` … 記号列
- スクリプト: `series_coverage.py`(本体), `gap_breakdown.py`, `build_report.py`, `live_check.py`/`live_check_static.py`(ライブHP検証)
- 再現: `cd c:/tmp && python series_coverage.py && python build_report.py`

関連: [[project_karuta_member_result_source]](正統ソース), [[project_bulk_load_handover]](投入), [[impl_tournament_results]](選手視点モデル=団体不可の理由)。
