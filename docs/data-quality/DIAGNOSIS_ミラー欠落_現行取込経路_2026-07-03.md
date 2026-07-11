# 診断: ミラー欠落100%と現行取込経路（Tier 2 ②）

- **実施日**: 2026-07-03（Tier 1 引き継ぎ後、コード調査のみ。本番DB・原本コーパスに接続できない環境で実施）
- **対象症状**: 東京東会 2025-11以降（t1159/t1160/t1184/t1195/t1196）・千葉 2024-2026（t981/t989/t997/t1108/t1138/t1216）のミラー欠落100%、千葉2026(t1216)の級名ゴミ「優勝1/2/3」、東京東会2024E(t995)のブロック潰れ
- **方法**: リポジトリのパーサ・取込コードの静的調査（Sonnet Explore エージェント2体で網羅→主要箇所は本体モデルで直接検証）

---

## 0. TL;DR

1. **「現行のメール取込経路でも同じことが起きるか」→ 起きる（確定）**。過去分の一括投入と現行メール経路は**同一のパーサ（`parseResultExcel`）と同一の書込器（`materializeResultDraft`）を共用**している。過去分バックフィルで発生した欠落は、同じ形式のファイルがメールで届けば現行経路でも必ず再現する。
2. **パーサにもDB書込にも「ミラー行」を生成・検証する機構は存在しない（確定）**。全バリアントの出力は「選手1人の視点の行」のみで、両側の行は**原本に両側が載っている場合にのみ**自然に生まれる設計。原本が片側しか持たない形式なら黙って片側だけDB化される。
3. 100%という一様な欠落率は「原本の表が構造的に片側のみ（1対戦=1行、または勝ち上がり形式）」を示唆する（**推測**）。(a)パーサ改修で救えるか (b)ミラー行の機械生成が必要かの確定には、**Tier 1 実施マシンでの原本突合が必要**（§5）。
4. 千葉2026の級名「優勝1/2/3」は**シート名フォールバックが無検証で通る**ことが原因（**コードで確定**）。
5. 東京東会2024Eのブロック潰れは**パーサに「ブロック」概念が無い**ことによる（機序はコードで確定、実ファイルの列構成は未確認）。

---

## 1. 経路の同一性（確定・本調査の最重要事実)

過去分一括投入スクリプト [scripts/diagnostics/_rehearse_load.mts](../../scripts/diagnostics/_rehearse_load.mts)（コミット d7a3705 で保存）は:

```ts
import { parseResultHtml } from '../mail-worker/src/result-import/html-parser.ts'
import { parseResultExcel } from '../mail-worker/src/result-import/parser.ts'
// …
await materializeResultDraft(tx, { parserVersion: 'bulk-1.1.0', classes: inst.classes }, …)
```

現行メール経路（`ResultParseButton` → `mailWorkerJobs` → `apps/mail-worker/src/result-import/run.ts` → `parseResultExcel` → 管理者承認 `approveResultDraft` → `materializeResultDraft`）と**パーサ・書込器が完全に同一**。パーサ最終更新は 2026-06-24 で一括投入（6/26-27）より前＝**本番の東京東会・千葉の行はこのコードの出力そのもの**。

> 補足（Tier1マシンで要確認）: 対象大会が実際にどちらの経路で入ったかは
> `SELECT id, name, source_result_draft_id FROM tournaments WHERE id IN (1159,1160,1184,1195,1196,1216);`
> で判別できる（non-null ならメール経路由来）。いずれにせよコードが同一なので結論は変わらない。

## 2. ミラー欠落の機序

### 設計前提（確定）

- パーサ出力の契約（`apps/mail-worker/src/result-import/schema.ts`）: `ParsedClass → participants[] → matches[]`。**「1対戦=両者ペア」を表す型は存在しない**。`opponentName` はただの文字列。
- DBスキーマの明文（`packages/shared/src/schema/matches.ts:6-11`）: 「1 試合 = 選手視点 1 行。通常の対戦は勝者○/敗者×の 2 行で重複出現」— **両側の行が原本に存在することが暗黙の前提**。
- `materializeResultDraft`（`apps/web/src/lib/result-import/materialize.ts:203-227`）は payload をそのまま 1:1 で insert。欠落側を検出・合成するコードは無い（自分で確認済み）。

### 片側だけになる条件（確定）

`parseDataRow`（`apps/mail-worker/src/result-import/parser.ts:263-267`、自分で確認済み）:

```ts
// If no result cell and no score, skip this round (player didn't play this many rounds)
if (!resultRaw && !scoreRaw && !opponentName) continue
const result = resultRaw ? parseResultChar(resultRaw) : null
if (!result) continue // unparseable result → end of played rounds for this player
```

相手側選手の行の当該回戦セルが空なら、そのラウンドは相手側から一切出力されない。行またぎの整合チェックは無い。**リポジトリ内のテスト fixture `CHIBA_SHEET`（`apps/mail-worker/test/result-import/parser-round-layout.test.ts:24-31`）自体がこの非対称を含んでいる**（選手三郎の2回戦「×選手二郎」に対し選手二郎の2回戦セルは全null→二郎側の行が生まれない）が、テストはこの非対称性を検証していない。

### 100%欠落の解釈（推測・原本突合待ち）

- 部分欠落（大垣20-70%等）は「敗退後の空欄・記入漏れ」型で説明がつく。
- **100%欠落**は級内の全対戦が例外なく片側のみ＝「原本の表が1対戦を1回しか記録しない形式」（1行=1対戦の対戦表、勝ち上がりトーナメント表など）である可能性が高い。族(c)（トーナメント表形式）はパーサが**意図的に未対応**（W3後回し、`docs/features/bulk-result-import/parser-implementation-plan.md`）なので、「対応外形式が中途半端に署名検出を通って片側だけ拾えている」シナリオもあり得る。

## 3. 級名ゴミ「優勝1/2/3」の機序（確定）

`parser.ts:356-360`（Primary）/ `:656-658`（Positional fallback）: 級・クラス列が検出できない単一クラスシートでは
`className = deriveClassNameFromSheet(sheet) ?? sheet.name` — **シート名がそのまま級名になり、バリデーション（allowlist）は一切無い**。`deriveGrade('優勝1')` は A〜E を含まないので grade=null。表示層 `TournamentDetailTabs.tsx` の `blockBadge` は grade=null のとき **生 className をそのままバッジ表示** → 症状が直接ユーザーに露出。

## 4. ブロック潰れ（東京東会2024E）の機序（機序確定・実ファイル未確認）

パーサに「ブロック」を認識するコードが存在しない（`grep ブロック` 0件）。クラス列の検出は `/^クラス$|^class$/i` のみ。ブロック列が認識されないと `className = gradeStr`（例「E」）に落ち、E1〜E14が単一クラス「E」へ統合される。round は列位置ベースの単純採番なので、各ブロックの「1回戦」が同じ round=1 で衝突 → Tier 1 の「同round重複112件」と整合。

## 5. 次アクション

### Tier 1 実施マシン（原本コーパスあり）でやること

1. 対象原本の特定: `c:/tmp/karuta_results` の新WP分（`new_download_index.csv` で東京東会79回 A/B/C/D/E・千葉3回/4回・千葉2024を逆引き）
2. 表構造の分類: **1行=1選手（各選手にN回戦列）か、1行=1対戦／勝ち上がり表か**
   - 1行=1選手で両側が埋まっている → パーサのバグ（列検出ずれ等）→ パーサ修正＋再取込
   - 片側のみの形式 → ミラー行の機械生成（反転補完）で救済 ＋ パーサ/取込側に恒久ガード
3. provenance 確認SQL（§1）
4. ①二重取込の原本確認（tier2-01 SQL草案の適用前提）も同じ機会に

### 恒久対策の候補（実装は要承認・Issue化はユーザーGO後）

| # | 対策 | 狙い |
|---|---|---|
| P1 | **取込ガード**: 承認画面に品質メトリクス表示（ミラー率・相手解決率・grade null率・級名パターン外警告・**同一edition×同gradeの参加者重複率**） | 現行経路の再発を人間の承認前に可視化。最後の項目は①二重取込の再発防止（identity が名前+日付のため、まとめ報告ファイルで今後も再発しうる） |
| P2 | パーサ: ブロック列認識＋シート名フォールバックの検証（級名パターン外は警告付き grade=null） | 症状(b)(c)の根治 |
| P3 | ミラー行の機械生成（原本が片側形式と確定した場合のみ。反転生成: win↔lose・score同値・status同値） | 症状(a)の救済。※原本確認前に実装しない |
| P4 | テスト整備: 片側入力・シート名ゴミ・ブロック統合の fixture 追加（現状この3ケースを検証するテストは無い） | 回帰防止 |

---

## 6. 本調査の制約

このセッションのマシンには SSH鍵（本番接続）・リハDB・原本コーパス（c:/tmp）・会員ページ資格情報が無く、**コード調査のみ**。原本突合と本番修正は Tier 1 実施マシン（または鍵・コーパスの移設後）で行うこと。
