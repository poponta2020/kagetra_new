---
name: impl_result_html_parser
description: "HTML結果パーサ(parseResultHtml) W1 SHIPPED。static HTML 4510ページを既存ParsedClass[]契約へ正規化。PR#167 merge 8c3ed1e。round-cell共通化、不戦壊れHTML全td走査"
metadata: 
  node_type: memory
  type: project
  originSessionId: c46027bf-8209-47b5-a303-06559f887d85
---

過去結果一括投入([[project_bulk_result_import_design]])の**取込フェーズ W1 = HTML結果パーサ**を実装・ship（2026-06-23）。[[project_karuta_member_result_source]] の HTML 4510ページ(641大会)が対象。計画書 `docs/features/bulk-result-import/parser-implementation-plan.md`。

## 成果（PR #167 merge `8c3ed1e`）
- **`apps/mail-worker/src/result-import/html-parser.ts`**: `parseResultHtml(html) → {tournamentName, eventDate('YYYY-MM-DD'), classes: ParsedClass[]}`。node-html-parser で `table.tournament_tree` 解析。級=`li.TabbedPanelsTabSelected`, 大会名=`h2`, 開催日=見出し`(YYYY年MM月DD日)`。`HTML_PARSER_VERSION='1.0.0'`。
- **`apps/mail-worker/src/result-import/round-cell.ts`**: 共通 `parseRoundCellText(text)`。round セルの「マーク/枚数/相手」を**種別抽出**(位置非依存)。○/〇→win, ×/✕→lose, 不戦→walkover win, 棄権→forfeit。**W2(positional Excel)で再利用予定**。
- 出力は既存 `parseResultExcel` と同一 `ParsedClass[]` 契約。`normalize.ts`/`materialize.ts`/`run.ts`/`schema.ts`/既存`parser.ts`は不変（新規ファイルのみ追加）。`node-html-parser@8.0.3` を mail-worker dependencies に追加。

## 非自明な決定（実データ駆動）
- **不戦(bye)は壊れHTML**: `<td class="result_cell">不戦</td><td>○ 1 相手</td>` と result_cell が早期に閉じ class無しtdが続く。→ **名前セル以降の全td走査**（td.result_cell 限定だと post-bye match を落とし列ずれ）。不戦=その回戦の walkover win(相手/枚数なし)、続くtd=次の回戦。round番号=td位置。
- **相手名のスコア除去**: opponentName 生成で全数字削除は名前内数字(山田2郎)を壊す(Codex R1)→ **最初の standalone 整数 token のみ除去**。さらに walkover/forfeit 複合セルでも整数 token は常に除去し scoreDiff 代入のみ normal 限定(Codex R2)。
- 級名は normalizeText(NFKC) で `G（シニア）`→`G(シニア)` に畳む(Excel経路と一致)。空ページ(成績未入力, result_cell=0)→`classes:[]`。

## 検証
- ユニット30ケース(round-cell+html-parser) green、型チェック・lint OK。
- **実コーパス回帰(git外, 4510ページ)**: 例外0 / 大会名・開催日100%抽出 / 参加者184,305人全員に試合 / 試合415,715(walkover56,093/forfeit1,788) / **相手解決99.9%**(359,361/359,622, 残りは同名等) / 空16ページのみ classes:[]。
- Codex auto-review 3R(全high, 累計243k tokens): R1 1sf(数字名)→R2 1sf(複合セル score leak)→**R3 pass**。CI green。

## 残（別PR/別フェーズ）
- **W2**: Excel署名検出拡張(positional 「N回戦」)。`round-cell.ts` 再利用。**既存75%通過の回帰固定必須**。
- W3(団体戦等異形) / Phase3(xls抽出不能7件・全コーパス健全性)。
- manifest生成→DB materialize(投入)は別フェーズ。investment スクリプトは並行ブランチ `feature/import-past-results`(stage④)で別途進行（W1とファイル非衝突=mail-worker vs web）。
