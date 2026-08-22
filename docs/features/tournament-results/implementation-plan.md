---
status: completed
---
# tournament-results 実装手順書（2026-08-22 改修: AI 取込補助 + 突合・部分承認・差し替え）

> 対象要件 = [requirements.md](requirements.md)（2026-08-22 改修版）。初版（決定的パーサ v1）のタスクは完了済み・git 履歴参照。
> 現行仕様の正典 = docs/spec/tournaments-results.md。

## 設計メモ（タスク共通の確定事項）

- **AI モジュール**: `apps/mail-worker/src/result-import/ai/` 新設。既存 `classify/llm/` と同じパターン（provider 中立インターフェース + forced tool use + Zod 検証 + fixture 注入 + `calculateCostUsd` 流用）。モデル定数はモジュール内に `ANTHROPIC_MODEL_ID = 'claude-sonnet-5'`（classify とは独立に bump 可能）。ルーティングは非ストリーミング max_tokens 4096・thinking disabled。フル抽出は `client.messages.stream()` + max_tokens 100_000・thinking disabled（出力中央値33k/p90 74k トークンの実測による）。
- **ルーティング出力スキーマ**（`RoutingResultSchema`）: `verdict: 'adopt'|'escalate'|'out_of_scope'` / `outOfScopeKind: 'team'|'roster_or_lottery'|'other'|null` / `classMap: [{ className, normalizedClassName, grade(A-E|null), exclude, note }]` / `meta: { tournamentName|null, editionNumber|null, eventDate|null, isCorrection }` / `issues: string[]`。
- **payload 拡張**: `ParsedClassSchema` に optional `rawClassName: string | null` を追加（正規化適用時に原値を保持。optional なので既存 payload と後方互換）。フル抽出産 payload は `parserVersion: 'ai-extract-<PROMPT_VERSION>'`。
- **result_drafts 新列**（全て nullable・既存行に影響なし）: `ai_routing jsonb` / `ai_model text` / `ai_prompt_version text` / `ai_tokens_input integer` / `ai_tokens_output integer` / `ai_cost_usd numeric(10,6)`（ルーティング+抽出の合算） / `ai_error text`（fail-open 時の記録） / `extraction_source text`（'parser' | 'ai'）。
- **承認フォームの契約**（T5/T6 共通。ここを正とする）: 既存フィールドに加えて `selectedClasses`（payload.classes の index 配列を JSON 文字列で送る。例 `"[0,2,3]"`）と `replaceGrades`（差し替えを明示した grade の配列 JSON。例 `"[\"C\"]"`）。approveResultDraft(draftId, formData) のシグネチャは不変。
- **差し替えトランザクション順序**（deep-advisor 設計・要件 §3.4）: ①draft/edition FOR UPDATE → ②旧 class id 群と旧側 player_id 集合を収集 → ③選択級のみで materialize（新 tournaments 行） → ④差し替え級の active fact（valid_to IS NULL）が旧 class を指すなら `linkActualResultClass(..., replaceExisting: true)` で新級へ → ⑤旧 class 群 DELETE（cascade）・class が 0 になった旧 tournaments 行も DELETE → ⑥監査: 全級差し替え時は旧 draft を status='superseded' + superseded_by_draft_id、部分差し替え時は旧 tournaments.note へ追記 → ⑦`recomputePlayerDisplayNames` + `syncPlayersToUniqueMembers` を（旧側∪新側 player）で再実行。
- **edition×級 突合データ**: `getEditionImportedGrades(editionId)` — edition 配下の tournaments→tournament_classes を grade 別に集計して返す read-only Server Action（`result-drafts/[id]/actions.ts` に新設。admin/mail-inbox/actions.ts には足さない=T4/T6 との衝突回避）。
- **将来制約の注記**: メール添付のプルーニングを将来導入する場合、approved / superseded の result_drafts が参照する添付は削除対象から除外すること（差し替えの復旧原本のため）。T7 で spec に明記。

## 実装タスク

### タスク1: shared スキーマ + migration（result_drafts AI 列）
- [x] 完了
- **目的:** AI 所見・コスト記録の永続化列を追加する
- **対応AC:** AC-5（記録先）、AC-9（extraction_source）
- **主な変更領域:** `packages/shared/src/schema/result-drafts.ts`、`packages/shared/drizzle/`（新規 migration 1本）、`docs/design/db.md`
- **依存タスク:** なし（migration 生成は main が担当）
- **必要なテスト:** スキーマ snapshot（既存パターンがあれば）。migration はテスト DB の自動 push で検証される
- **完了条件:** `pnpm check-types` 通過・migration が生成済み・db.md 更新
- **対応Issue:** #534

### タスク2: mail-worker AI 基盤モジュール（result-import/ai/）
- [x] 完了
- **目的:** ルーティングとフル抽出の AI クライアントを、テスト可能な provider 中立モジュールとして実装する
- **対応AC:** AC-1（classMap 生成）、AC-8（フル抽出出力の Zod 検証）
- **主な変更領域:** `apps/mail-worker/src/result-import/ai/`（新規: types.ts / routing-schema.ts / prompt.ts / anthropic.ts / fixture.ts）、`apps/mail-worker/src/result-import/schema.ts`（rawClassName 追加）、`apps/mail-worker/test/result-import/ai-*.test.ts`
- **依存タスク:** なし（新規ファイル群 + schema.ts の後方互換追加のみ）
- **必要なテスト:** ルーティングスキーマ検証・classMap 適用純関数・フル抽出出力の schema 不整合→エラー・fixture クライアントの契約テスト（classify/llm/fixture.ts 踏襲）
- **完了条件:** 新規テスト green（ファイルスコープ lint 通過）
- **対応Issue:** #535

### タスク3: run.ts へのルーティング統合（fail-open・エスカレート・PDF・AI 列保存）
- [x] 完了
- **目的:** result_parse ジョブに AI ルーティングを組み込み、判定に応じて採用/フル抽出/警告へ振り分ける
- **対応AC:** AC-1, AC-2（fail-open）, AC-4（メタ保存）, AC-5, AC-6（worker 側 PDF 経路）, AC-7, AC-8, AC-9
- **主な変更領域:** `apps/mail-worker/src/result-import/run.ts`、`apps/mail-worker/src/index.ts` / `config.ts`（API キーの受け渡し配線）、`apps/mail-worker/test/result-import/run.test.ts`
- **依存タスク:** タスク1（AI 列）、タスク2（モジュール）
- **必要なテスト:** fixture 注入で ①adopt 時の classMap 適用+原値保持 ②AI 例外時の fail-open（ai_error 記録・pending_review 生成） ③0 classes→フル抽出発動 ④PDF→抽出直行 ⑤escalate verdict→フル抽出 ⑥AI 列（トークン・コスト合算・extraction_source）の保存
- **完了条件:** run.test.ts green・既存ケースの回帰なし
- **対応Issue:** #536

### タスク4: PDF トリガー許可（web 側導線）
- [x] 完了
- **目的:** `.pdf` 添付でも「結果として取り込む」を実行できるようにする
- **対応AC:** AC-6（トリガー側）
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（triggerResultParse の拡張子条件 L2106-2109）、`apps/web/src/app/(app)/admin/mail-inbox/mail/[id]/page.tsx`（セクション表示条件）、`apps/web/src/app/(app)/admin/mail-inbox/components/ResultParseButton.tsx`
- **依存タスク:** なし（**actions.ts はタスク6 も触るため、タスク6 より先に完了させる順序制約**）
- **必要なテスト:** triggerResultParse の拡張子受理（.pdf 許可・その他拒否）テスト
- **完了条件:** テスト green
- **対応Issue:** #537

### タスク5: 承認画面 UI（AI 所見・級チェックボックス・突合バッジ・差し替え操作）
- [x] 完了
- **目的:** 部分承認・差し替え・AI 所見を承認画面で操作/確認できるようにする
- **対応AC:** AC-3, AC-4（プリフィル）, AC-9（由来表示）, AC-10, AC-13（クライアント側ガード）, AC-16, AC-17
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/result-drafts/[id]/`（page.tsx / components/ApproveResultDraftForm.tsx / **新規** actions.ts=getEditionImportedGrades）・同ディレクトリのコンポーネントテスト
- **依存タスク:** タスク1（AI 列の読み出し）。フォーム契約は本書「設計メモ」を正とする
- **必要なテスト:** ①AI 所見（対象外警告・訂正版促し・AI 抽出由来・AI 検証なし）の表示分岐 ②edition 確定時の取込済みバッジ+既定 OFF ③edition 未確定時の全級既定 ON ④0級選択時の submit ガード ⑤eventDate/大会名プリフィル
- **完了条件:** コンポーネントテスト green
- **対応Issue:** #538

### タスク6: 承認アクション（級選択フィルタ・差し替えトランザクション）
- [x] 完了
- **目的:** 部分承認と差し替え（物理削除+fact 再リンク+監査記録）を approveResultDraft に実装する
- **対応AC:** AC-11, AC-12（回帰）, AC-13, AC-14, AC-15, AC-18（回帰）, AC-22
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（approveResultDraft）、必要なら `apps/web/src/lib/result-import/`（差し替えヘルパー切り出し）、対応テスト
- **依存タスク:** タスク1、タスク4（actions.ts 順序）、タスク5（フォーム契約の確定。並行させず後続にする）
- **必要なテスト:** ①部分承認: 選択級のみ materialize ②全級選択=現行結果と同一（回帰） ③0級エラー ④差し替え: 旧級 DELETE・空 tournaments DELETE・draft superseded（全級時）/note 追記（部分時） ⑤active fact の新級への再リンク（revision 生成） ⑥display_name/会員リンクの削除後再計算 ⑦既存の状態ガード回帰
- **完了条件:** テスト green（DB 依存テストはテスト DB・--no-file-parallelism）
- **対応Issue:** #539

### タスク7: docs 更新 + 総合回帰
- [x] 完了
- **目的:** 正典 docs を変更後の姿へ更新し、全体回帰を確認する
- **対応AC:** AC-19, AC-20（CI green）
- **主な変更領域:** `docs/spec/tournaments-results.md`（取込フロー・AI ルーティング・部分承認・差し替え・復旧手順）、`docs/spec/mail-worker.md`（添付プルーニング将来制約の注記）、`docs/design/db.md`（タスク1で未反映なら）
- **依存タスク:** タスク3、タスク5、タスク6
- **必要なテスト:** なし（docs）。全パッケージのテスト・lint・typecheck は CI に委譲
- **完了条件:** docs 更新済み・CI green
- **対応Issue:** #540

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1（shared+migration・main 担当）, タスク2（mail-worker 新規モジュール）, タスク4（web actions.ts+mail 詳細） — 3タスクは変更領域が重ならない
- Wave 2: タスク3（mail-worker run.ts。T1+T2 依存）, タスク5（web result-drafts/[id]/**。T1 依存） — 領域直交で並行可
- Wave 3: タスク6（actions.ts。T4 完了済み・T5 のフォーム契約確定後）
- Wave 4: タスク7（docs+総合回帰）

## AC-21（manual）の消化手順

出荷後、本番で級別分割の後続メール（例: 次に届く多摩/さがみ野系の級別報告）を1通取り込み、①先行取込済みの級に「取込済み」バッジが出る ②未取込級だけの部分承認が通る ことを実機確認する。確認完了を memory の残 DoD に記録する。
