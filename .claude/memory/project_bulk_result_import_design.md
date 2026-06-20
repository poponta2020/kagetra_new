---
name: bulk-result-import-design
description: 過去大会結果Excelの本番一括投入の設計方針（開催単位identity・人確定manifest・訂正版優先dedup・リハーサル）
metadata: 
  node_type: memory
  type: project
  originSessionId: 85f6ce81-70fc-4ccb-8988-ba69aa23a261
---

過去の大会結果Excel（数百件）を本番DBに一括投入する方針。2026-06-21 確定・**実装未着手**。[[impl_tournament_results]] のパーサ（[[impl_fix_result_parser_shusshadb]] で出場者DB形式修正済）と materialize を再利用する。

**同一性 =（正規化大会名 ＋ 開催日）× 級**。tournament 行は**開催単位**で作る。これで「同じ大会名でも3月/8月開催」「同じD級を年2回」「級ごとに開催日が違う」を全てスキーマ変更なしで表現できる。**重要**: 1大会に束ねて class に日付を持たせる案は、parser/materialize が className で級を一意 MERGE するため**年2回同級でデータ消失**する＝採用不可。大会ブランドの束ね（第N回〜を1見出しに）は後の表示用 series で足す。

**完全自動化しない**: 投入単位は「1年分のExcel群」。私が全部パース→「大会候補 × 級 × 開催日 × 選手/試合数」をリスト化→**ユーザーが名寄せ・採用級・重複採否・日付を確定（manifest）**→確定 manifest で投入。日付は最も当てにならない（報告作成日≠競技日、ファイル名に無いものが多数）ため自動キーに依存しない。

**重複（同一開催で前の級を再掲）**: 同一(大会名,日付)の同級は1回。採用は **max(試合数) ではなく訂正版/改定版/新しい方を優先**（訂正は行が減ることがある）＋衝突は提示。

**本番投入の安全**: コピーDB(pg_dump→別DB)でリハーサル→**冪等スクリプト(再実行可)**→開催単位tx→**書込後 read-back で件数照合**→本番。[[tool-output-fabrication]] のため独立検証必須。dry-run ハーネスは c:\tmp（実パーサに grids を通す、[[feedback_dont_rush_requirements_data_first]] 実践）。

**スコープ外**: 熊本票（大会報告/詳報シート）は署名検出されず0件＝別バグ未対応。同姓同名は [[homonym-risk-accepted]]。
