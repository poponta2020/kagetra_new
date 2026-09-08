---
status: completed
---

# mail-ai-extract-refinements 実装手順書（2026-09-08 改修: D・E 級の地域制限判定）

親Issue: #612

要件定義書: [requirements.md](./requirements.md)（今回の対象は §3.2.12 / §3.2.2 の `regional_eligibility` / AC-64〜AC-80）

> 前回（2026-09-07 改修: 通称と系列の相互連動）のタスクは PR #605 で出荷済み。本書は今回の改修タスクで上書きしている（完了済みタスクの記録は git 履歴が保持する）。

## 技術設計の要点（調査で確定したこと）

| 論点 | 結論 |
|---|---|
| 判定の出力先 | `EventUnit.regional_eligibility: { grade, verdict, evidence_quote, evidence_verified? }[]`（**必須・空配列可**）。tool の forced use で必ず埋まる。**マイグレーション不要**（`tournament_drafts.extracted_payload` の JSON 内） |
| ワーカー専用項目 `evidence_verified` | Zod では `z.boolean().optional()` として同じ `EventUnitSchema` に持つ（型を二重化しない）。**Anthropic へ渡す input_schema からだけ削る**（`anthropic.ts` が `z.toJSONSchema` の結果から `events.items.properties.regional_eligibility.items.properties.evidence_verified` を除去し、`required` にも載せない）。AI が出しても Zod の strip と classifier の上書きで無効化される |
| 照合の実行点 | `classifyMail`（`apps/mail-worker/src/classify/classifier.ts`）の成功経路。`attachmentsForLlm` を組み立てるループで**同時に**照合用テキスト（本文＋PDF は `extractedText ?? ''`・text 種別は転送した本文・lazy fallback で得たテキストも含む）を集め、`llm.extract` 成功後に `annotateRegionalEvidence(parsed, corpus)` で `evidence_verified` を全要素に書き込んでから `{ kind: 'tournament' }` を返す。`persistOutcome` はそのまま `result.parsed` を保存するので変更不要。`runManualExtract` / `reextractDraft` / `reextract` CLI はすべて `classifyMail` 経由なので自動的に対象 |
| 正規化 | `s.normalize('NFKC').replace(/[\s\u200b\ufeff]+/gu, '')`。`\s`（`u` フラグ）は全角スペース U+3000 を含む。それ以上の寛容化はしない |
| 定数の置き場 | 新規 leaf `apps/mail-worker/src/classify/regional.ts`（依存ゼロ）: `HOME_REGION = '北海道'`、`REGIONAL_ELIGIBILITY_GRADES = ['D','E'] as const`、4値は `HOME_REGION` から合成（`制限なし` / `${HOME_REGION}は対象` / `${HOME_REGION}は対象外` / `要確認`）。`apps/mail-worker/package.json` の `exports` に `./classify/regional` を追加し、Web は `@kagetra/mail-worker/classify/title` と同じ経路で import する（`'use client'` から引ける leaf であること） |
| Web 側の判断ロジック | 純関数 `planRegionalEligibility(unit)`（新規 `apps/web/src/app/(app)/admin/mail-inbox/regional-eligibility-utils.ts`。`process-candidate-utils.ts` と同じく DB 非依存の client leaf）が `{ removedGrades, effectiveGrades, allRemoved, notices }` を返す。外す条件は **`verdict === 対象外 && evidence_verified === true && eligible_grades に含まれる`** の3条件。`ApprovalForm` はこの結果を `composeTitle` の入力・`EventForm` の `defaultValues.eligibleGrades`・`registered` の初期値に流す |
| Server Action | **変更なし**。`extractEventUnitsFormData` の `grade_*` 読み取り・`approveDraftUnits` の保存はそのまま（AC-77） |
| 旧ドラフト | `NormalizedUnit.regional_eligibility` は optional。無ければ `planRegionalEligibility` は何も外さず notices 空（AC-75）。`page.tsx` の防御的ナローイングは変更不要 |
| `ExtractedPayloadView` | 汎用ループは `formatValue` が object を `[object Object]` にするため、`regional_eligibility` をループから除外して専用の小表で描く |
| fixture | 3 ファイルとも D・E を含まない（AB / null / null）ので `regional_eligibility: []` を足すだけ。`FIXTURE_DEFAULT_PAYLOAD` にも同様に追加。他フィールドは1バイトも変えない（AC-78） |
| プロンプト | `PROMPT_VERSION` 3.1.0。新セクション「D・E 級の地域制限」＋ Example 3（札幌 A〜D）に参加資格の一文を足して D=制限なしの例に、Example 4（D・E で条件が異なる案内）を新設。few-shot の根拠は本文の一文と**文字どおり一致**させる |
| design-screen | 不要（`design_required: false`）。警告ブロックは `source_mismatch` バナーと同じトークン（`border-warn-fg/30 bg-warn-bg text-warn-fg`）を使う |

## 実装タスク

### タスク1: 抽出契約の拡張（定数・スキーマ・プロンプト・fixture・tool schema）
- [ ] 完了
- **目的:** AI が `regional_eligibility` を返し、ワーカー専用項目が AI に見えない状態を作る。以降の全タスクの土台
- **対応AC:** AC-64, AC-65, AC-66, AC-67, AC-78
- **主な変更領域:** `apps/mail-worker/src/classify/regional.ts`（新規）/ `apps/mail-worker/src/classify/schema.ts` / `apps/mail-worker/src/classify/prompt.ts` / `apps/mail-worker/src/classify/llm/anthropic.ts` / `apps/mail-worker/src/classify/llm/fixture.ts` / `apps/mail-worker/test/fixtures/llm/*.expected.json` / `apps/mail-worker/package.json`（exports）
  - `regional.ts`: `HOME_REGION`・`REGIONAL_ELIGIBILITY_GRADES`・`REGIONAL_VERDICTS`（4値・`HOME_REGION` から合成）と型。依存ゼロの leaf
  - `schema.ts`: `RegionalEligibilitySchema = { grade: enum(D,E), verdict: enum(4値), evidence_quote: string|null, evidence_verified: boolean (optional) }`。`EventUnitSchema.regional_eligibility: z.array(...)`（必須）。`superRefine` に ①同一単位内の `grade` 重複を拒否 ②`verdict !== '要確認'` で `evidence_quote` が `null`/空白のみなら拒否、を追加。既存の3不変条件は維持
  - `anthropic.ts`: `z.toJSONSchema` の結果から `evidence_verified` を除去する小さなヘルパー（パスが見つからなければ例外にして黙って無効化させない）。`$schema` 削除の直後に呼ぶ
  - `prompt.ts`: `PROMPT_VERSION = '3.1.0'`（doc コメントに 3.1.0 の項を追記）。「# D・E 級の地域制限(regional_eligibility)」セクション（判定対象 D・E のみ／「北海道の選手」の定義／4値の定義と例／優先枠は制限ではない／海外特例は無視／所属会条件は対象外／記載なしは要確認／根拠は資料から一字一句そのまま・整形禁止・一文〜数文／D・E を含まない単位は `[]`）。反例に「優先枠を制限と誤認」「根拠を要約する」を追加。Example 1・2 に `"regional_eligibility": []`、Example 3 の本文に「参加資格: 全級とも地域の制限はありません」を足して D を `制限なし`（根拠はその一文そのまま）、Example 4 を新設（D・E 級のみ・D=中国・四国地方在住等／E=四国地方在住等で両方 `北海道は対象外`。抽選の優先順を書いて「優先枠は判定に使わない」を示す）。出力サマリにも1行追加
  - fixture 3 件と `FIXTURE_DEFAULT_PAYLOAD` に `regional_eligibility: []`（**他は変えない**）
  - `package.json` exports に `"./classify/regional": "./src/classify/regional.ts"`
- **依存タスク:** なし
- **必要なテスト:**
  - `test/classify/schema.test.ts`: D・E 以外の grade／重複 grade／4値外の verdict が失敗（AC-64）。非要確認で `evidence_quote` null・空白のみが失敗、要確認の null は通る（AC-65）。`evidence_verified` を含む/含まないどちらも parse できる。`regional_eligibility` 欠落は失敗（必須）
  - `test/classify/prompt.test.ts`: `PROMPT_VERSION === '3.1.0'`（AC-66）。AC-67 の各指示文字列（「D 級・E 級」「北海道」「制限なし」「北海道は対象」「北海道は対象外」「要確認」「優先」「一字一句」等）と、few-shot の全ブロックが `regional_eligibility` を持ち、少なくとも1ブロックで D・E の verdict が異なる/両方対象外であること
  - `test/classify/anthropic.test.ts`: 送信された `input_schema` に `evidence_verified` が**どこにも現れない**こと（JSON 文字列化して `includes` で確認）と、`regional_eligibility` が `events.items.required` に含まれること
  - `test/classify/fixture.test.ts`（既存）が fixture 3 件を読み込めること
- **完了条件:** 上記テスト green、`pnpm --filter=@kagetra/mail-worker exec tsc --noEmit`（または `pnpm check-types`）通過
- **対応Issue:** #613

### タスク2: 根拠の一文の機械照合（ワーカー）
- [ ] 完了
- **目的:** AI が返した根拠が、実際に渡した資料に含まれるかを照合し、結果をドラフトへ保存する
- **対応AC:** AC-68, AC-69
- **主な変更領域:** `apps/mail-worker/src/classify/evidence.ts`（新規）/ `apps/mail-worker/src/classify/classifier.ts`
  - `evidence.ts`: `normalizeEvidenceText(s)`／`buildEvidenceCorpus(texts: string[])`／`annotateRegionalEvidence(payload, corpus): ExtractionPayload`（全単位・全要素に `evidence_verified` を書き込む。`evidence_quote` が null・空白のみなら `false`。元 payload は変更せず新しいオブジェクトを返す）
  - `classifier.ts`: `attachmentsForLlm` を組むループで `evidenceTexts` も集める（PDF → `att.extractedText ?? ''`、text 種別 → 転送した `text`、lazy fallback の text も）。本文は `input.emailBodyText`。`llm.extract` 成功後に注釈して `result.parsed` を差し替える。失敗経路・`oversize_skipped`・`skipped_noise` は不変
- **依存タスク:** タスク1（`regional_eligibility` / `evidence_verified` の型）
- **必要なテスト:**
  - `test/classify/evidence.test.ts`（新規）: AC-68 の4ケース（①完全一致 ②言い換え・「…」省略は不一致 ③空コーパスは不一致 ④コーパス側の「202 6 年」・全角スペース・改行混じりでも一致）。全角英数と半角の NFKC 同一視。null 根拠は `false`
  - `test/classify/classifier.test.ts`: fixture の本文に根拠を含む/含まないメールで `classifyMail` を通し、`outcome.result.parsed.events[0].regional_eligibility[0].evidence_verified` が true/false になる。PDF 添付の `extractedText` が空のとき false。いずれも `kind: 'tournament'` のまま（AC-69 のワーカー側）
- **完了条件:** 上記テスト green、typecheck 通過
- **対応Issue:** #614

### タスク3: 承認フォームの初期値と警告（Web）
- [ ] 完了
- **目的:** 照合済みの「北海道は対象外」の級を対象級の初期値から外し、外したこと・確認が要ることを根拠付きで見せる
- **対応AC:** AC-69（承認可能のまま）, AC-70, AC-71, AC-72, AC-73, AC-74, AC-75, AC-77
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/regional-eligibility-utils.ts`（新規）/ `apps/web/src/app/(app)/admin/mail-inbox/components/RegionalEligibilityNotice.tsx`（新規）/ `apps/web/src/app/(app)/admin/mail-inbox/components/ApprovalForm.tsx`（＋ `ApprovalForm.test.tsx`）
  - `regional-eligibility-utils.ts`: `planRegionalEligibility(unit: { eligible_grades, regional_eligibility? })` → `{ removedGrades, effectiveGrades, allRemoved, notices: { grade, kind: 'removed' | 'unverified' | 'review' | 'eligible', quote: string | null }[] }`。`制限なし` は notices に出さない。`regional_eligibility` 欠落・空なら何もしない。定数は `@kagetra/mail-worker/classify/regional` から
  - `RegionalEligibilityNotice.tsx`: notices と `allRemoved` から警告/注意/補足を描く表示専用コンポーネント。文言は requirements §3.2.12(d) の表のとおり。`source_mismatch` バナーと同じトークン
  - `ApprovalForm.tsx`: `NormalizedUnit` に `regional_eligibility?: EventUnit['regional_eligibility']` を追加。単位ごとに plan を計算し、①`composedTitleOf` が `effectiveGrades` を `composeTitle` に渡す ②`EventForm` の `defaultValues.eligibleGrades` に `effectiveGrades` ③`registered` の初期値を `!plan.allRemoved` ④単位カードの「このイベントを登録する」ラベルと `<fieldset>` の間に `RegionalEligibilityNotice`（fieldset の外＝未チェックでも読める）。登録済み単位・旧ドラフトでは何も出ない
  - **型の波及:** `EventUnit.regional_eligibility` が必須になるため、`EventUnit` 型で組んでいる既存リテラル（`ApprovalForm.test.tsx` の `buildUnit`、他に `check-types` が指摘する箇所）に `regional_eligibility: []` を足す。`payment_deadline_kind` を含む他ファイルの多くは events テーブル側で無関係 — typecheck の指摘だけに従い、無関係な一括修正をしない
- **依存タスク:** タスク1（型と定数）。タスク2とはファイルが重ならないので並行可
- **必要なテスト:**
  - `regional-eligibility-utils.test.ts`（新規）: 照合済み対象外 D/E → removed・effective=[A,B,C]／未照合対象外 → 外さず unverified／要確認 → review／北海道は対象 → eligible／制限なし → notices なし／`eligible_grades` に無い級の判定は無視／全級対象外 → allRemoved／`regional_eligibility` 欠落 → 何もしない
  - `ApprovalForm.test.tsx`: A〜E 単位で D・E が照合済み対象外 → 通称「兵庫」で title が「兵庫ABC」、`grade_D`/`grade_E` が unchecked・A〜C checked（AC-70）／警告に級名と根拠の一文が出る（AC-71）／未照合対象外・要確認は checked のままで確認文言（AC-72）／D・E のみ全外れで `register` が unchecked＋警告、再チェックで送信できる（AC-73）／北海道は対象は checked のまま補足あり・制限なしは表示なし（AC-74）／`regional_eligibility` 無しの payload と registered 単位で表示なし（AC-75）／`grade_D` を再チェックして submit すると FormData に `grade_D=on` が乗る（AC-77 の UI 側）
  - `actions.test.ts` は変更しない（既存 green で AC-77）
- **完了条件:** 上記テスト green、`pnpm check-types` 通過、`pnpm --filter=@kagetra/web exec eslint <変更ファイル>` green
- **対応Issue:** #615

### タスク4: AI 抽出結果ビューに判定・根拠・照合状態を表示（Web）
- [ ] 完了
- **目的:** フォームに出ない「制限なし」も含め、AI の判定と根拠を読み取り専用で確認できるようにする
- **対応AC:** AC-76
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/components/ExtractedPayloadView.tsx`（＋新規 `ExtractedPayloadView.test.tsx`）
  - 汎用ループの `filter` で `regional_eligibility` を除外し、単位の表の直後に「地域制限（D・E 級）」の小表（級／判定／根拠の一文／照合: 照合済み・未照合・—）を描く。空配列・欠落なら何も出さない。`EXTRACTED_LABELS` にラベルを追加
- **依存タスク:** タスク1（型）。タスク2・3とはファイルが重ならないので並行可
- **必要なテスト:** `ExtractedPayloadView.test.tsx`（新規）: 判定4種＋照合済み/未照合/null 根拠の表示、`[object Object]` が出ないこと、`regional_eligibility` 無しの旧 payload で表が出ないこと
- **完了条件:** テスト green、typecheck・eslint 通過
- **対応Issue:** #616

### タスク5: 仕様書の更新（docs）
- [ ] 完了
- **目的:** 正典 `docs/spec/mail-worker.md` を変更後の挙動に合わせる（gate-dod D2）
- **対応AC:** —（DoD の docs ゲート）
- **主な変更領域:** `docs/spec/mail-worker.md`（「AI 抽出」節の `ExtractionPayloadSchema` 段落に `regional_eligibility`・4値・根拠の照合・`PROMPT_VERSION` 3.1.0 を追記。「ドラフト承認詳細」節に承認フォームの初期値と警告の規則を追記）/ `docs/features/INDEX.md`（`mail-ai-extract-refinements` の行に 2026-09-08 改修の一文を追記）
- **依存タスク:** タスク2, 3, 4（確定した挙動を書く）
- **必要なテスト:** なし（docs）
- **完了条件:** 該当節が in-place 更新されている（changelog 追記や別ファイル化をしない）
- **対応Issue:** #617

## 実装順序（Wave = 並行実装できるタスクの組）
- Wave 1: タスク1（契約の土台。全タスクの依存元）
- Wave 2: タスク2, タスク3, タスク4（互いに依存なし・変更領域が重ならない: `classify/evidence.ts`+`classifier.ts` ／ `regional-eligibility-utils.ts`+`RegionalEligibilityNotice.tsx`+`ApprovalForm.tsx` ／ `ExtractedPayloadView.tsx`）
- Wave 3: タスク5（docs）

## 出荷後の手動確認（AC-80・manual）
ローカル dev DB（`kagetra-db`）に実要綱がある次の5メールで「再 AI 抽出」を行い、判定と根拠の一文を目視確認する（ANTHROPIC_API_KEY が必要）:
①兵庫（mail_attachments.id=45: D・E とも対象外、A〜C は判定なし） ②丸亀（id=60: D・E とも対象外 → 単位が既定 OFF） ③北海道初心者大会（id=96: E=北海道は対象） ④横浜 E 級（id=97: 制限なし。優先枠を制限と誤認しない） ⑤埼玉 D 級（id=89: 要確認）
