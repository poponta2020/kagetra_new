---
name: fix-result-parser-shusshadb
description: 大会結果パーサの出場者DB形式バグ修正（氏名=ふりがな/所属=所属会2 誤採用）。PR
metadata: 
  node_type: memory
  type: project
  originSessionId: d865c359-8b0e-44ff-858a-5b38fdfa2c1f
---

[[impl_tournament_results]] のパーサ（apps/mail-worker/src/result-import/parser.ts）の「出場者DB」形式（伊助ツール）バグを修正。PR #165 merge `cb8589f`（2026-06-20）。**Issue 未起票**（ユーザー指示で起票せず先に修正）。

**症状**: 愛知大会の取込で結果承認画面が全員ひらがな・所属ほぼ空。

**原因（非自明）**: 出場者DB シートは `選手名`+`選手名ふりがな`、`所属会`+`所属会2`(通常空) と**同種ヘッダを2列併存**させる。parser のヘッダ検出が **last-match-wins**（最後にマッチした列で上書き）で後者を採用 → 氏名=ふりがな・所属=空・**相手解決0%**（自分=ひらがな vs 相手列=漢字で normalizePlayerName 不一致）。実票42件中**13件**（全日本選手権/大阪/静岡/広島/桑名/信州/富山/奈良/酒田 等）で発生。正常28件は氏名=列1・所属=列2の単一列形式で無影響。

**修正**: ①`isPlayerNameHeader` をふりがな列除外（`/選手名|氏名|名前/` かつ `!/ふりがな|フリガナ|カナ|読み|かな/`）→ 選手名漢字を採用＋ふりがなは kanaCol に正取得、②`playerNameCol` と補助列検出を **first-match-wins**（所属会採用・所属会2無視）。Codex 1R pass（high・43k tokens）。

**検証手法（再現可・[[feedback_dont_rush_requirements_data_first]] 実践）**: docs/調査用 実票を Python（xlsx=openpyxl / .xls=xlrd）でグリッド化→Node の type-strip で**実 parser.ts** に通す before/after ハーネス（c:\tmp、git外）。異常13→0・正常不変・相手解決0→100%。検証足場は Drive 同期 repo 内 scripts には**置かない判断**（スコープ外）。リポジトリ実体は `G:\マイドライブ\kagetra_new`（symlink）で Drive 同期下＝gitignore でも別PCに同期される。

**残/別件**: ①本番反映後に**愛知ドラフト却下→再取込**で正データ化（承認前のため DB 無傷）。②**熊本票（シート: 大会報告/Ａ級詳報/Ｂ級詳報）は署名検出されず0件取込の別バグ**＝未対応（サイレントに成功に見え危険、別 issue 候補）。
