---
name: impl_result_excel_positional
description: "positional「N回戦」Excel署名検出(W2) SHIPPED。primary null時のみ起動するfallbackで未検出234中122回収。PR#168 merge 1ac583e。Codex6R(5修正)。回帰0/garbage0.06%"
metadata: 
  node_type: memory
  type: project
  originSessionId: c46027bf-8209-47b5-a303-06559f887d85
---

過去結果一括投入([[project_bulk_result_import_design]])の取込フェーズ **W2 = Excel positional「N回戦」署名検出**を実装・ship（2026-06-23）。[[impl_result_html_parser]] (W1) の `round-cell.ts` を再利用。計画書 `docs/features/bulk-result-import/parser-implementation-plan.md`。

## 成果（PR #168 merge `1ac583e`）
- **`parser.ts`**: `detectRoundLayoutSignature` + `parseRoundLayoutSheet/Row` 追加。**primary `detectSignatureRow` が null の時のみ起動**＝既存75%通過に構造的に無影響（回帰0実証）。`PARSER_VERSION` 1.1.0。
- 検出: `回戦`ラベル行＋`氏名/選手名`列が必須。サブ見出し（相手/対戦相手/結果/○✕/勝敗/枚数/点数/差/数）があれば各ブロック内の相手/マーク/枚数列を識別して №/級/所属/勝/負 を無視、無ければ位置ベースで全ブロック連結。抽出は `parseRoundCellText` 再利用。
- **`round-cell.ts`**: スコアトークンを符号付き対応（○＋５/×－16 → 絶対値）、● を負けマークに追加（トークン除去 regex にも ●）。
- **`normalize.ts`**（W2 で唯一の最小変更）: `parseResultChar` も ● を lose に（primary パスと整合）。

## 非自明な決定（Codex 6R で収束）
- **誤検出4重ガード**: ①氏名見出し必須=チーム名/学校名を除外 ②回戦≥1 ③○×結果ゼロは却下=チーム点数表 ④相手が数値ばかり(<50% name-like)は却下=№/マトリクス誤認。
- **markCol 基準の join**: サブ見出しで markCol(勝敗) が見つかった時のみ識別 join（補助列スキップ）、無い時(no-sub/ragged 最終回戦)はブロック全体を positional join して data の結果を拾う。
- **dataStartIdx = max(hasSub?+2:+1, nameRowIdx+1)**: 氏名ヘッダ行を必ずスキップ（さもないと name='氏名' の bogus participant 混入）。
- **isMarkHdr は ○✕ ラベル(2+文字)のみ**: 単一 ○/× は data なので header 誤判定しない。
- **isScoreHdr と subHits を統一**(数/差): 片方だけだと scoreDiff 欠落。

## 検証
- ユニット96 green（parser-round-layout 16 + round-cell/normalize 拡張）。**既存 parser.test.ts 26 は無改変で全 green=primary 回帰固定**。
- **実コーパス回帰(git外, 936 Excel)**: before-ok 702 → **after-ok 824（+122回収）**、**REGRESSIONS=0**、相手名 garbage **0.06%**（残りは source #N/A）。自見↔原の勝敗・枚数が双方向一致（クロス検証）。surname-opponent シートは相手解決低いが参加者の戦績は正。
- Codex auto-review **6R(全 high, 累計~386k tokens) → R6 pass**。5修正（●strip / 氏名ヘッダ+単一回戦 / ●primary / ragged 最終回戦 / 数列）。CI green。

## 残（W3/別フェーズ）
- **W3**: 団体トーナメント表/チーム順位表/挑戦者決定戦・名人戦/入賞報告のみ（誤検出ガードで除外済＝未対応で正）。残234未検出のうち~112が W3。W2 で per-match 表は概ね回収。
- Phase3: xls抽出不能7件(6414.xls 等)・全コーパス健全性レポート。manifest→DB materialize(投入)は別フェーズ([[project_bulk_result_import_design]])。
