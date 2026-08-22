---
name: impl-tournament-results-ai-revamp
description: tournament-results AI改修 実装記録
type: project
---

tournament-results 改修（AI 取込補助 + 突合・部分承認・差し替え、親 Issue #533）の実装記録。worktree = `C:/tmp/impl-tournament-results` / ブランチ `feature/tournament-results`。

## Wave 編成の実績（計画からの逸脱を含む）

- 実装手順書は Wave 1 = T1+T2+T4 と宣言していたが、**T1（shared スキーマ + Drizzle migration）は main 担当タスクなので単独先行**させた（/implement の規律「main 直タスクはワーカーと同時に走らせない」）。次に計画を書くときは main タスクを Wave に混ぜないこと。
- 実行順: T1（main 単独）→ Wave 1 = T2 + T4（task-implementer 2並行）→ Wave 2 = T3 + T5 → T6（main 単独）→ T7。

## 完了タスク

- **T1 (#534)** `08ff630`: `result_drafts` に AI 列8本（ai_routing jsonb / ai_model / ai_prompt_version / ai_tokens_input / ai_tokens_output / ai_cost_usd numeric(10,6) / ai_error / extraction_source）を全て nullable で追加。migration `packages/shared/drizzle/0061_lumpy_jackal.sql`（ALTER ADD COLUMN 8本のみ）。db-tables-tournaments.md も同コミットで更新。
- **T2 (#535)** `5dfd584`: `apps/mail-worker/src/result-import/ai/` 新設（types / routing-schema / prompt / anthropic / fixture / apply / index）。`ParsedClassSchema` に optional `rawClassName` 追加。テスト26件 green。
- **T4 (#537)** `0d2de4c`: `isResultImportAttachment`（`apps/web/src/lib/result-import/attachment.ts`）を単一ソースにして .pdf を受理。テスト15件 green。

## 設計上の要点（後から効く）

- **`'use server'` ファイルは非 async の値を export できない** ため、拡張子判定の純関数は `apps/web/src/lib/result-import/attachment.ts` という依存ゼロ leaf に置き、actions.ts と page.tsx の双方から import する形にした。
- **フル抽出の usage は `stream.finalMessage()` から取る**。ストリームイベントから積み上げると 0 になり、ai_cost_usd が「浅いテストは通るのに実コストが 0 で記録される」形で静かに壊れる（advisor 指摘・実装済み）。
- `tournament_edition_grade_lottery_facts.actual_result_class_id` の FK は **ON DELETE SET NULL**。差し替えで旧クラスを物理削除すると、既に valid_to を閉じた**過去 revision の指す class も NULL 化**される（active fact は削除前に新クラスへ再リンクするので無事）。履歴の劣化として受容する判断。
- web から AI ルーティング結果の型を使うため `apps/mail-worker/package.json` の exports に `./result-import/ai/routing-schema` だけを追加した（barrel を公開すると Anthropic SDK まで web バンドルに引き込むため）。
- ワーカーには `worker_verify: none` の理由（共有テスト DB への `drizzle-kit push --force` 競合）を明示的に伝え、テストは書くだけ・実行は main が直列、で運用。Wave 1・2 とも領域の食い違いゼロ。

## 完了タスク（続き）

- **T3 (#536)** `99cfa03`: `runResultParse` に optional `ai` を統合。PDF は `readExcel` より前で分岐（`detectExcelFormat` が `.pdf` で throw するため、後だと誤って parse_failed になる）。adopt→classMap 適用 / escalate・0クラス・PDF→フル抽出 / out_of_scope→決定的パース採用（警告は画面側）。fail-open は「決定的パース結果があれば pending_review + ai_error」、ただし **extract() の AiValidationError だけは parse_failed**。`ANTHROPIC_API_KEY` 未設定でも `buildResultImportAi` が warn して undefined を返し、取込自体は落とさない。mail-worker result-import テスト 216 件 green。
- **T5 (#538)** `198993f`: 承認画面に AI 所見カード（表示分岐は `buildAiNotices` 純関数に切り出し）・級チェックボックス・取込済みバッジ・差し替えチェック。`getEditionImportedGrades` は `result-drafts/[id]/actions.ts` へディレクトリローカルに新設（親 actions.ts との衝突回避）。16 件 green。
- **T6 (#539)** `3888603`: `approveResultDraft` の部分承認 + 差し替えトランザクション。ヘルパーは `apps/web/src/lib/result-import/replace.ts`。19 件 green（既存回帰含む）。
- **T7 (#540)** `bb70269`: spec/tournaments-results.md・spec/mail-worker.md・SPECIFICATION.md を更新。

## T6 の実装で効いた判断

- **差し替え級は「取り込む級の中に grade がちょうど1つ」を必須にした**。旧級を消す一方で再リンク先が決まらないと、`teglf_actual_class_fk` の ON DELETE SET NULL で active fact の `actual_result_class_id` が黙って null 化する（＝当落線の根拠が消えたのに誰も気づかない）。既存 auto-link の `gradeClasses.length !== 1` スキップと同じ思想を、差し替え側では「スキップ」ではなく「エラー」にした。
- **差し替えには開催回の明示選択を必須**にした（大会名の自動解決に委ねない）。旧側の収集は materialize より前に行う必要があり、そのとき edition が確定していないと対象が決まらないため。
- **旧側 player の再計算は削除の後**。materialize は内部で新側を再計算済みなので、削除後に旧側集合だけ回せば新旧どちらにも出る選手も最新化される。テストは「旧=『田中 太郎』(variant 優先で選ばれる) / 新=『田中太郎』」を用意し、最終 display_name が『田中太郎』になることで**削除後の再計算が本当に走ったか**を判別している。
- 旧 tournaments を消すと FK(SET NULL) で旧ドラフトの `tournament_id` も消えるため、**superseded にするドラフト id は削除前に控える**。

## AC-14 の「再承認で復元」の解釈（実装前に確認済み）

`approveResultDraft` は `status !== 'pending_review'` を弾くので superseded ドラフトの直接再承認はできない。要件が言う復元経路は**メールから再取込 → 再パース → 再承認**（`superseded` は `OVERWRITABLE_DRAFT_STATUSES` と `triggerResultParse` の許可リスト双方に入っている）。旧 `extracted_payload` は監査用に保持されるだけ。status ガードの変更は不要と判断した。

## 出荷後に残る手作業 DoD（AC-21・消化手順つき）

**AC-21（manual・未消化）**: 本番で級別分割の後続メール（例: 次に届く多摩／さがみ野系の級別報告）を1通取り込み、以下を実機確認する。

1. `/admin/mail-inbox/mail/<id>` で該当添付を選び「結果として取り込む」を実行
2. 30秒タイマー後に `/admin/mail-inbox/result-drafts/<id>` を開き、**先行取込済みの級に「取込済み」バッジが出て既定チェックが OFF** になっていること
3. 未取込級だけにチェックが入った状態で承認が通り、その級だけ materialize されること
4. AI 所見カード（対象外警告／訂正版促し／AI 抽出由来／AI 検証なし）が想定どおり出ること

確認できたらこの節を「消化済み」に書き換える。**本番デプロイ後に `ANTHROPIC_API_KEY` が worker 側に渡っているかも同時に確認する**（未設定なら決定的パースのみで動き、`ai_error` すら記録されず warn ログだけになるため、静かに機能が無効化される）。

## 出荷前レビューで潰した落とし穴（advisor 指摘・PR 前に修正済み）

- **`applyClassMap` が全級を exclude すると空 payload が pending_review になり、承認画面が操作不能になる**（級の行なし・ボタン恒久 disabled・理由表示なし）。adopt+全除外→フル抽出へエスカレート、out_of_scope+全除外→parse_failed、に修正。フォーム側にも級ゼロ時の理由表示を保険で追加。
- **AC-4 の「回次が edition 自動解決の入力に渡る」は `meta.tournamentName` が「第N回」を含むかどうかに全依存**する（`meta.editionNumber` はどこからも読まれない。`autoResolveEdition` はフォームの大会名文字列から回次をパースする）。プロンプトに「回次を含めたフルネームで返す」ことを明記して PROMPT_VERSION を 1.1.0 へ。
- `mail_attachments.size_bytes` は `notNull` なので PDF サイズガードの `>` 比較は null すり抜けしない（確認済み・修正不要）。
