# 過去結果パーサ拡張＋HTML結果パーサ 実装計画

> bulk-result-import の「**取込（パース）フェーズ**」本体。最終ゴールは
> **多様な Excel ＋ HTML を同一 `ParsedClass[]` に正規化するパーサ群**。
> manifest 生成 → DB materialize（投入）は**別フェーズ＝今回スコープ外**。ただし出力契約は厳守。
>
> 前提メモリ: `project_karuta_member_result_source` / `project_bulk_result_import_design` /
> `impl_tournament_results` / `impl_fix_result_parser_shusshadb`

---

## Phase 0: Documentation Discovery（完了・確定事実）

3つの discovery subagent で確定した「実在する API / 構造 / 制約」。**推測ではなく実ファイル引用**。

### A. 出力契約（materialize が消費する型）— 不変

`apps/web/src/lib/result-import/materialize.ts:39-43`
```ts
materializeResultDraft(tx, payload: ParsedResultPayload, opts: {
  tournamentName: string; eventDate: string | null;
  venue: string | null; sourceResultDraftId: number
}): Promise<{ tournamentId: number }>
```
- `ParsedClass`（`schema.ts`）が消費する**必須 non-null**: `className`、各 participant の `name`、各 match の `round`/`result('win'|'lose')`/`status('normal'|'walkover'|'forfeit')`。それ以外（grade, sheetName, affiliation, nameKana, prefecture, seqNo, dan, memberNo, finalRank, roundLabel, opponentName, scoreDiff）は **null 可**。
- **相手解決は両側に `normalizePlayerName`**（materialize.ts:166,177-184）。自名と相手名は**同一表記系で格納**する（materialize 側で正規化キー化、ちょうど1人一致時のみ id 解決、多重/不明は `opponentName` テキストのまま）。→ HTML/positional パーサも**自名と相手名を同じ生表記で出す**こと。
- `payload.parserVersion` は materialize では**読まれない**（来歴スタンプのみ。run.ts が `result_drafts.parserVersion` に記録）。

### B. テスト方式（`parser.test.ts` 既存パターン）

- **テストは `apps/mail-worker/test/result-import/` に置く**（`src/` ではない）。
- フィクスチャは**インラインのハンドクラフト**。実データ（実名）は git 外。ヘルパ `makeSheet(name, rows)`（parser.test.ts:24-26）。
- import は**相対パス＋`.js` 拡張子必須**（NodeNext）。例 `'../../src/result-import/parser.js'`。
- アサーションは `ParsedClass[]` を直接検査（`toHaveLength`、`participants.find(p => p.name === ...)`、`m.status/result/scoreDiff/opponentName/round/roundLabel`）。
- テストコマンド `vitest run`（`apps/mail-worker`、`fileParallelism: false`、`environment: 'node'`）。

### C. HTML パーサ用ライブラリ — **新規追加が必要**

- monorepo に宣言済みの HTML パーサは root devDep の **jsdom 25 のみ**。mail-worker からは未宣言＝本番コードで使うのは不可。
- **決定: `apps/mail-worker/package.json` に `node-html-parser` を追加**（最小・依存ほぼ無し・`querySelector(All)` 対応・node 環境向き）。代替候補は htmlparser2（mailparser 経由で 8.0.2 が transitive 済）だが selector が無くコード量増。jsdom は重く dev 限定なので不採用。
- mail-worker は `module: ESNext` / `moduleResolution: bundler`、**相対 import に `.js` 必須**。

### D. HTML DOM 構造（harvest 済 4510 ページ・実測）

```
<div style="...;text-align:center;..."><h2>第29回…シニア選手権大会</h2>(2017年05月21日)</div>
…
<li class="TabbedPanelsTabSelected">B2</li>        ← 級＝選択中タブのテキスト（例 A / B2 / C1 / G（シニア））
…
<table class="tournament_tree">
  <tr><th>選手名</th><th>1回戦</th>…<th>N回戦</th></tr>   ← 所属/順位/段位 列は無い
  <tr>
    <td class="result_cell">渡辺令恵<br/>（相模女子大学かるた会）</td>  ← 名前<br/>（所属）
    <td class="result_cell"> ○  4  北野律子 </td>           ← 勝: マーク/枚数/相手（空白改行区切り）
    <td class="result_cell"> ×  4  渡辺令恵 </td>           ← 敗
    …
  </tr>
</table>
```
- **日付見出し**: `</h2>` 直後の `(YYYY年MM月DD日)`（月日ゼロ埋め、例 `(2017年05月21日)`）。
- **級・大会名・日付は全てページ内から取得可**。cid/tid は**ファイル名 `{cid}_{tid}.html` のみ**（DOM に無い）。
- **不戦（bye）セルは壊れた HTML**: `…不戦</td><td> ○ 1 相手 …`。`result_cell` が早期に閉じ、次に**素の `<td>`**が開く＝その行のセル数が見出しより増える。**列ずれを前提に堅牢化必須**（DOM パーサ前提、正規表現単独は不可）。
- **空ページ**（成績未入力）= `<table>` に `<th>選手名</th>` のみで選手行ゼロ（コーパス中 5 ページ）。**スキップ対象**。
- 1 ファイル = 1 級ページ（= `ParsedClass` 1個）。

### E. 既存 Excel パーサ（`parser.ts`）の検出ロジックと 176 失敗の根因

- `detectSignatureRow`（parser.ts:71-182）は **選手名 + 相手(相手) + 勝敗(勝敗) の3点必須**（parser.ts:91 で `相手`/`勝敗` が無いと `continue` → そのシートは `[]`）。
- 失敗 176 の主因 = 見出しが **「N回戦」マージのみ**でサブ見出し（相手/枚数/勝敗）が無く、各回戦の**相手/枚数/勝敗がセル内改行**（＝ HTML の result_cell と同型）または**回戦ブロック内の位置ベース列**。
- **重要な統一点**: HTML の round セル `○ / 4 / 北野律子` と、この positional Excel セルは**同じ「1セルに改行区切りで マーク/枚数/相手」**。→ **共通ヘルパ `parseRoundCellText(text)` を W1 で作り W2 で再利用**できる。

### Allowed APIs（使ってよい既存資産）/ Anti-patterns

- 使う: `normalize.ts` の `normalizeText` / `deriveGrade` / `parseResultChar` / `parseScoreCell` / `normalizePlayerName`（**変更しない**）、`schema.ts` の型、`SheetData/CellValue`（reader.ts）。
- `parseScoreCell` は `不戦勝`/`棄権` を**完全一致**で判定（normalize.ts:47-48）。HTML/positional の bare `不戦` は**ヒットしない**→ 共通ヘルパ側で `不戦`/`棄権` を**部分一致**で status 判定する。
- Anti-pattern: `normalize.ts` 改変 / `materialize.ts`・`run.ts`・`schema.ts` のインターフェース変更 / 既存 `parseResultExcel` の**プライマリ検出経路の挙動変更** / jsdom を mail-worker prod で使用 / harvest スクリプト(c:\tmp)を本実装へ混入 / 実名フィクスチャの commit。

---

## Phase 1（W1）: HTML 結果パーサ新規実装  → **PR その1**

**対象**: static HTML 4510 ページ（641 大会）。現状 0%。新規コードのため**回帰リスク最小**。

### 実装物（COPY 元を明示）

1. `apps/mail-worker/package.json` の dependencies に `node-html-parser`（最新安定）を追加。`pnpm install`。
2. **新規 `apps/mail-worker/src/result-import/round-cell.ts`** — 共通ヘルパ。
   ```ts
   export interface ParsedRoundCell {
     result: 'win' | 'lose' | null
     scoreDiff: number | null
     status: 'normal' | 'walkover' | 'forfeit'
     opponentName: string | null
     empty: boolean   // 真＝その回戦は未対戦（match を生成しない）
   }
   export function parseRoundCellText(text: string): ParsedRoundCell
   ```
   - 仕様: `normalizeText` 後、空 → `{empty:true}`。`○/〇`→win、`×/✕`→lose（`parseResultChar` を文字単位で適用）。最初の整数 → `scoreDiff`。`不戦`含む → `status:'walkover'`、`棄権`含む → `'forfeit'`。マーク・数値・status 語を除いた残り → `opponentName`（空なら null）。**位置に依存せず種別で抽出**（順序揺れに堅牢）。
3. **新規 `apps/mail-worker/src/result-import/html-parser.ts`**:
   ```ts
   export const HTML_PARSER_VERSION = '1.0.0'
   export interface ParsedHtmlResult {
     tournamentName: string | null
     eventDate: string | null            // 'YYYY-MM-DD'（見出しから）
     classes: ParsedClass[]              // 通常 length 1（1ファイル=1級）
   }
   export function parseResultHtml(html: string): ParsedHtmlResult
   ```
   - `node-html-parser` の `parse(html)` → `root.querySelector('table.tournament_tree')`。
   - 級: `root.querySelector('li.TabbedPanelsTabSelected')?.text` → `className`、`grade = deriveGrade(className)`。
   - 大会名: `root.querySelector('h2')?.text`。日付: h2 の親 `<div>` テキストから `/(\d{4})年(\d{2})月(\d{2})日/` → `YYYY-MM-DD`。
   - 各 `<tr>`（ヘッダ除く）→ participant。先頭 `td.result_cell` を `<br/>` で割り、前＝`name`（normalizeText、生表記維持）、`（…）`内＝`affiliation`。
   - 2セル目以降の round セルを `parseRoundCellText` で解析。**列ずれ（不戦の壊れHTML）対策**: 行内の全 `<td>`（class 不問）を名前セル以降で順に走査し、`empty` でない結果のみ round 1..N に連番付与（task 5 で実データ検証）。
   - 空ページ（選手行ゼロ）→ `classes: []`。`sheetName: null`、auxiliary 列（kana/prefecture/dan/memberNo/seqNo/finalRank）は HTML に無いので **null**。

### テスト（テストファースト）

`apps/mail-worker/test/result-import/html-parser.test.ts` と `round-cell.test.ts` を**先に**書く（合成名・インラインHTML文字列、`parser.test.ts` 流儀、`.js` import）。最低ケース:
- `round-cell`: 勝(`○ 4 相手`)/敗(`× 4 相手`)/不戦(`不戦 ○ 1 相手`→walkover)/棄権/空文字/順序揺れ。
- `html-parser`: 2回戦・勝敗、複数回戦、所属あり/なし、級タブ抽出、日付見出し抽出、**不戦の壊れHTML**、空テーブル→`classes:[]`、相手名と自名が同表記。

### Verification checklist

- [ ] `pnpm --filter @kagetra/mail-worker test` green、`pnpm --filter @kagetra/mail-worker typecheck`（または turbo）green。
- [ ] 出力が `ParsedClass[]` の zod（`schema.ts`）を満たす（テスト内で `ParsedClassSchema.parse` で固める）。
- [ ] **git 外 回帰スクリプト**（commit しない、`c:\tmp\assess_html.mts`、`assess.mts` を踏襲）で**実 4510 ページ**を流し、(a) パース成功率、(b) 空5ページのみ classes:[]、(c) 相手解決可能率（自名集合に相手名が含まれる率）をレポート。`reference_tool_output_fabrication` 警戒で出力 jsonl を独立 read-back。

### Anti-pattern guards

- 正規表現単独で `<td>` を割らない（不戦の壊れHTMLで破綻）。**DOM パーサ経由**。
- `normalizePlayerName` を**パーサ内で適用しない**（生表記で出し、正規化は materialize に委譲）。
- 日付を `Date` で解釈しない（`Date.now`/`new Date()` 無関係でも、文字列 `YYYY-MM-DD` を素直に組む）。

---

## Phase 2（W2）: Excel 署名検出の拡張（positional N回戦）  → **PR その2**

**対象**: static xls の未検出 ~176。**既存 75%（702/936）を1件も壊さないこと（回帰固定が最優先）**。

### 設計の肝（低回帰アーキテクチャ）

- **プライマリ経路（parser.ts:71-182 の現行 `相手+勝敗` 検出）は一切変更しない**。
- `parseSheet`（parser.ts:256）で**プライマリが null を返した時だけ**新フォールバック `detectRoundLayoutSignature` を試す（＝現在 `[]` に落ちているシートのみ対象なので、通過中シートは構造的に無影響）。
- 唯一の回帰リスクは「現在正しく捨てている報告/入賞シートを誤検出」。→ 新署名は **選手名列 + 「N回戦」見出し列が複数」を必須にし、`大会報告`/`入賞`/`表紙` を誤射しない特異度**を持たせる。

### 実装物

1. **W2 task 1（コード前の実データ discovery）**: `c:\tmp\categorize_fails.py` を流し「結果シートあるのに未検出」176 のヘッダ・先頭行形状をダンプ → レイアウト族にクラスタリング:
   - (a) 1セル=1回戦・改行区切り `マーク/枚数/相手`（HTML 同型）
   - (b) 「N回戦」マージ見出し下に**サブ見出し無しの3列**（相手/枚数/勝敗が位置固定）
   - (c) その他（W3 送り候補）。族ごとの件数を記録し、(a)(b) を本 PR の対象に確定。
2. `parser.ts` に **`detectRoundLayoutSignature(grid)`** を追加（プライマリの後段フォールバック）。`回戦` を含む見出しセル群を round 列として収集、選手名列を特定、auxiliary 列は既存検出を流用。
3. round セル解析:
   - 族(a) → **`round-cell.ts` の `parseRoundCellText` を再利用**（W1 で実装済）。
   - 族(b) → 各回戦ブロックの位置オフセットで opponent/score/result を取り、`parseResultChar`/`parseScoreCell` で評価。
4. `PARSER_VERSION` を **'1.1.0'** に更新（出力カバレッジ変化＝来歴バンプ。materialize は無視するが run.ts が記録）。

### テスト（テストファースト＋回帰固定）

- **回帰ベースライン**を先に取得: 現行 `parseResultExcel` で実コーパスを流した `c:\tmp\assess_output.jsonl` を**スナップショット保存**。W2 後に再実行し、**以前 ok だったシートが1件も fail に転じないこと**（単調改善）を diff で機械確認。
- 既存 `parser.test.ts` は**フィクスチャ無改変で 100% green を維持**（変更が必要になったら破壊的変更＝要承認）。
- 新規フィクスチャ（合成名・`makeSheet`）で族(a)(b) の positional レイアウトが parse できることを追加。報告/入賞シート（`REPORT_SHEET` 等）が**新経路でも `[]` のまま**であることを明示テスト。

### Verification checklist

- [ ] 既存 `parser.test.ts` 全 green（無改変）＋新規テスト green、typecheck green。
- [ ] 回帰スクリプト diff: **before-ok ∧ after-fail = 0**、かつ ok 件数が 702 から上昇（目標は 176 の大半回収。族(c) 残は数値で記録）。
- [ ] 誤検出ゼロ確認: 入賞/報告のみ 49 群が引き続き 0 participant-with-match。

### Anti-pattern guards

- プライマリ検出経路に手を入れない（フォールバックは**追加のみ**）。
- 新署名を緩くしすぎない（`回戦`列が1つだけ等は族(c)送り、誤検出より取りこぼしを選ぶ＝可逆）。
- `normalize.ts` 不変。`不戦勝`完全一致の穴は `round-cell.ts` 側で吸収（normalize.ts を触らない）。

---

## Phase 3: 周辺（W4）＋ 全コーパス最終検証  → 小 PR or W2 に同梱

1. **W4 — xls 抽出不能7件**: 評価は Python `xlrd` だが**本番 `reader.ts` は libreoffice 変換**。7件を本番 reader 経路（libreoffice→ExcelJS）で再検証し、(a) 本番では読める→対応不要、(b) 真に壊れている（例 `6414.xls` OLE2）→個別手当て（再保存/除外）を**ファイル単位で判断・記録**。reader.ts は本番依存のためローカル Windows では再現不可＝**本番 or libreoffice 環境で確認**。
2. **全コーパス通し**: W1(HTML 4510) + W2(Excel 936) を流し、`ParsedClass[]` 健全性（zod 通過率、相手解決率、級・日付取得率）を**単一レポート**に集約。実名のため**git 外**で実行、出力は独立 read-back（捏造警戒）。

### W3（後回し・記録のみ／本計画では実装しない）

団体戦(2) / トーナメント表 / 挑戦者決定戦 / ID順・勝順形式 等の少数異形。族(c) として件数を残し、別 Issue 化。**今回スコープ外**。

---

## 実行順・PR 分割・制約

- 順序: **W1（新規・低リスク）→ W2（回帰固定）→ Phase 3**。W1 と W2 は別 PR（1PR=1機能）。`round-cell.ts` は W1 で導入し W2 が再利用。
- CLAUDE.md: テストファースト（テスト→実装）、worktree 隔離（`/do-plan`、Windows は `C:\tmp\...` 明示パス＝`feedback_windows_worktree_path`）、テスト破壊は承認必須、共有 main 直接作業禁止。
- 不変: `materialize.ts` / `run.ts` / `schema.ts` / `normalize.ts`。`parseResultExcel` の出力契約（`ParsedClass[]`）を HTML パーサも満たす。
- 投入（manifest→materialize→read-back）は**別フェーズ**。本計画は「正規化パーサ群」までで停止。

## このフェーズの Definition of Done

- [ ] W1: `parseResultHtml` + `round-cell.ts` 実装・テスト green・実 4510 ページ回帰 OK → PR ship。
- [ ] W2: `detectRoundLayoutSignature` 実装・既存テスト無傷・実コーパス単調改善（before-ok∧after-fail=0）→ PR ship。
- [ ] Phase 3: 7 件判断記録＋全コーパス健全性レポート。
- [ ] claude-mem 記録（設計判断・完了）。
