---
status: completed
---

# mail-ai-extract-refinements 実装手順書

親Issue: #410

要件定義書: [requirements.md](./requirements.md)（AC は §4）

## 技術設計の要点（調査で確定したこと）

| 論点 | 結論 |
|---|---|
| `capacity_total` の保存先 | **`events.capacity` 既存列**（汎用イベント定員。イベント編集画面で読み書きされている）。マイグレーション不要 |
| `payment_method` の日本語 enum と `events.paymentType` | **別物として分離を維持**。`paymentType`（`advance`/`onsite`）は申込管理ボード・支払い催促で現役。AI は `payment_method`（text 列）だけ日本語で埋め、`paymentType` には触らない |
| `payment_deadline_kind` の保存先 | **payload に加えて `events.payment_deadline_kind` へも持ち回す**。pgEnum `fixed`/`later_notice`/`unspecified`（DB は英語値・既存 `eventPaymentTypeEnum` の慣行に合わせる）、notNull default `unspecified`。CHECK `(payment_deadline IS NOT NULL) = (payment_deadline_kind = 'fixed')`。backfill は `payment_deadline` 有 → `fixed` / 無 → `unspecified` |
| 添付選択の永続化 | `tournament_drafts.selected_attachment_ids integer[]`（nullable。`null` = 旧データ／未指定＝全件）を追加。migration 1本 |
| 選択ダイアログの表示情報 | `mail_attachments` の `filename` / `contentType` / `sizeBytes` で足りる（追加取得なし） |

## 実装タスク

### タスク1: 出力スキーマ改訂と fixture 移行
- [x] 完了
- **目的:** `ExtractionPayloadSchema` を変更後の形にし、既存 fixture を回帰ベースラインを保ったまま移行する
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-8, AC-21
- **主な変更領域:** `apps/mail-worker/src/classify/schema.ts`、`apps/mail-worker/test/fixtures/llm/*.expected.json`、`apps/mail-worker/test/classify/*.test.ts`
- **依存タスク:** なし（**共有ホットスポット。後続タスクの前提となるので先行させる**）
- **必要なテスト:** 削除フィールドが input_schema に無いこと／`events` 空配列で validate 失敗／`unit_key` 重複で validate 失敗／`payment_deadline_kind: "日付あり"` かつ `payment_deadline: null` で validate 失敗／`payment_method`・`entry_method` が enum 外の値を弾くこと
- **完了条件:** 型チェック通過、`apps/mail-worker` のスキーマ関連テストが green
- **注意:** fixture の**再生成は禁止**（回帰ベースラインが消える）。移行手順は要件 AC-21 の①〜⑥に限定する:
  - 既存値をそのまま残す: `event_date` / `eligible_grades` / `formal_name` / `venue` / `entry_deadline` / `payment_deadline` / `payment_info_text` / `organizer_text` / `kind` / `capacity_a`〜`e` / `official`
  - `fee_jpy` と削除対象の全体項目を除去
  - `payment_deadline_kind` を追加（日付があれば「日付あり」、無ければ「記載なし」。元案内が後日連絡を含む場合のみ「後日連絡」）
  - `capacity_total` を追加（元案内に記載がなければ `null`）
  - `payment_method` / `entry_method` は既存値を新 enum へ読み替え（`bank_transfer`→「口座振込」等）
  - `newsletter.expected.json`（ノイズ陰性ケース）は削除し、`FixtureLLMExtractor` の既定応答を「ノイズ返し」から外す
- **対応Issue:** #411

### タスク2: PDF サイズ上限の引き上げ
- [x] 完了
- **目的:** `MAIL_WORKER_PDF_SIZE_LIMIT_KB` の既定を 800 → 8000 にする
- **対応AC:** AC-35
- **主な変更領域:** `apps/mail-worker/src/config.ts`、`apps/mail-worker/test/config.test.ts`
- **依存タスク:** なし
- **必要なテスト:** 既定値が 8000 であること／`0` でガード無効が維持されること／空文字が既定にフォールバックすること（既存テストの期待値更新）
- **完了条件:** `apps/mail-worker` の config テストが green
- **対応Issue:** #412

### タスク3: Sonnet 4.6 / Sonnet 5 のトークン実測（移行ゲート）
- [x] 完了
- **目的:** モデル移行の可否を数字で判断する。**これが通らない限りタスク5のモデル差し替えを確定しない**
- **対応AC:** AC-24
- **主な変更領域:** `scripts/diagnostics/`（使い捨て）、`docs/features/mail-ai-extract-refinements/token-baseline.md`（新規）
- **依存タスク:** なし
- **必要なテスト:** なし（調査タスク）
- **完了条件:** 代表的な大会案内 PDF 1件（本文＋PDF 添付）について両モデルの `count_tokens` を実測し、`token-baseline.md` に入力トークン数と比率を記録。**比率が 1.5 倍を超えた場合はユーザーに移行可否を確認してから先へ進む**
- **対応Issue:** #413

### タスク4: プロンプト改訂（分類撤去・新項目のガイダンス）
- [x] 完了
- **目的:** システムプロンプトから分類の記述を撤去し、新項目の抽出ガイダンスを追加する
- **対応AC:** AC-5, AC-6, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-21
- **主な変更領域:** `apps/mail-worker/src/classify/prompt.ts`、`apps/mail-worker/test/classify/prompt.test.ts`
- **依存タスク:** タスク1
- **必要なテスト:** 禁止文字列（「大会案内でない」「confidence」「メーリングリストのダイジェスト」「訂正」）を含まないこと／`PROMPT_VERSION === '3.0.0'`／「振込先は抽選後に別途ご連絡します」を含む fixture で `payment_deadline_kind: "後日連絡"`／全体定員のみの fixture で `capacity_total` に値・級別は null／級別の明示が無い fixture で `capacity_a`〜`e` が全て null
- **完了条件:** プロンプト関連テストが green
- **注意:**
  - **削除**: 「大会案内 vs ノイズ」節／Example 3（物販メール陰性例）／confidence 自己評価ルーブリック／訂正版の扱いの節／Example 4（訂正版）／反例のうち誤判定系／出力サマリの分類関連行／`short_name_stem` の節／参加費の抽出指示
  - **追加**: `payment_deadline_kind` の3値と「後日連絡」の判定材料／`payment_method`・`entry_method` の日本語選択肢／`capacity_total` と級別定員の併記対応と**逆算禁止の再明記**／`source_mismatch` の申告条件
  - **`source_mismatch` に「大会案内か判定せよ」と書かない。**「渡された資料が明らかに別種の文書だったときだけ申告せよ」に限定する（撤去した判断を別名で呼び戻さないため）
  - Few-shot は Example 1（単一日複数級）と Example 2（級別開催日＋和暦の申込期間）を新スキーマに合わせて更新し、`payment_deadline_kind` と `capacity_total` を含む例を1つ足す
- **対応Issue:** #414

### タスク5: Anthropic クライアントの Sonnet 5 移行
- [x] 完了
- **目的:** モデル差し替え・`thinking: disabled` 明示・プロンプトキャッシュ撤去・命名の追随
- **対応AC:** AC-22, AC-23, AC-25
- **主な変更領域:** `apps/mail-worker/src/classify/llm/anthropic.ts`、`apps/mail-worker/src/classify/cost.ts`（コメントのみ）、`apps/mail-worker/test/classify/anthropic.test.ts`
- **依存タスク:** タスク3（実測ゲート通過が前提）。**タスク4 の成果は移行可否に依存しない** — #413 が否（1.5倍超でユーザーが移行を見送り）となっても、プロンプト改訂はそのまま有効なので巻き戻さない
- **必要なテスト:** `model: 'claude-sonnet-5'` と `thinking: { type: 'disabled' }` がリクエストに含まれること／system ブロックに `cache_control` が無いこと／既存の tool_use 抽出・Zod 検証・エラー分岐が維持されること
- **完了条件:** `apps/mail-worker` の Anthropic クライアントテストが green
- **注意:** `ANTHROPIC_SONNET_46_MODEL_ID` → `ANTHROPIC_MODEL_ID`、`AnthropicSonnet46Extractor` → `AnthropicExtractor` にリネームし、`index.ts` / `reextract.ts` / `apps/web` の import を追随させる。`cost.ts` の単価は Sonnet 5 も定価同一のため**数値変更なし**。ただし導入価格期間中は実請求を過大に記録する旨をコメントに残す。キャッシュ撤去により `cache_creation_input_tokens` / `cache_read_input_tokens` は常に 0 になる
- **対応Issue:** #415

### タスク6: classifier に添付選択を通す
- [x] 完了
- **目的:** 選択された添付だけを LLM へ渡し、本文は常に渡す
- **対応AC:** AC-20, AC-30, AC-36
- **主な変更領域:** `apps/mail-worker/src/classify/classifier.ts`、`apps/mail-worker/src/classify/llm/types.ts`、`apps/mail-worker/test/classify/classifier.test.ts`
- **依存タスク:** タスク1, タスク4
- **必要なテスト:** **`messages.create` に渡るリクエストボディ**で本文 text ブロックの存在を4ケース検証（①添付ありで選択ゼロ ②添付0件 ③text 種別のみ選択 ④選択復元の再抽出）／未選択 PDF が document ブロックに含まれないこと／選択が全て上限内なら `oversize_skipped` にならないこと／上限超過が直接渡された場合は従来どおりスキップすること
- **完了条件:** classifier テストが green
- **注意:** `classifyMail` に選択を渡す口を足す。**選択が空でも本文だけで LLM を呼ぶ**（早期 return しない）。`oversize_skipped` ガードは**削除しない**（Server Action 直叩き・多重タブへの防御）
- **対応Issue:** #416

### タスク7: マイグレーションと Server Action
- [x] 完了
- **目的:** 選択を永続化し、Server Action で検証する
- **対応AC:** AC-31, AC-32, AC-40, AC-41
- **主な変更領域:** `packages/shared/src/schema/tournament-drafts.ts`、`packages/shared/src/schema/events.ts`、`packages/shared/src/schema/enums.ts`、Drizzle migration 1本、`apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（`triggerExtractDraft` / `reextractDraft`）、`apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts`
- **依存タスク:** タスク6
- **必要なテスト:** CHECK 制約が矛盾する組み合わせを弾くこと／backfill 後に全既存行が CHECK を満たすこと／選択が永続化され再抽出時に復元されること／サイズ超過の添付 ID を含む選択が拒否されること／当該メールに属さない添付 ID が拒否されること／既存の多重起動ガード（`triageStatus` / `linkedEventId` / `ai_processing`）が維持されること
- **完了条件:** Server Action テストが green、migration が `db:migrate` で適用できること
- **注意:** **この migration で2つの変更をまとめて行う**
  - `tournament_drafts.selected_attachment_ids integer[]` nullable（`null` = 旧データ／未指定＝全件扱い）
  - `events.payment_deadline_kind` — 新規 pgEnum `fixed`/`later_notice`/`unspecified`、notNull default `unspecified`。CHECK `(payment_deadline IS NOT NULL) = (payment_deadline_kind = 'fixed')` を付け、backfill（`payment_deadline` 有 → `fixed` / 無 → `unspecified`）を**CHECK 追加より前に**実行する（順序を誤ると既存行で制約違反になる）
  - **マイグレーション番号の衝突を確認する**。検証は既存の `FOR UPDATE` トランザクション内で行い、多重起動ガードを弱めない
- **対応Issue:** #417

### タスク8: 添付選択ダイアログ
- [x] 完了
- **目的:** 「会で流す（AI 抽出）」を添付選択ダイアログに拡張する
- **対応AC:** AC-26, AC-27, AC-28, AC-29
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/components/AIExtractConfirmDialog.tsx`、`apps/web/src/app/(app)/admin/mail-inbox/mail/[id]/page.tsx`、同ディレクトリのテスト
- **依存タスク:** タスク7
- **必要なテスト:** 添付一覧（ファイル名・種別・サイズ）が出て既定で全て未チェック／上限超過はチェック不可＋理由表示／添付ありで全未チェック時に確認が1段入る／添付0件では確認なしで実行できる
- **完了条件:** ダイアログのテストが green
- **注意:** ボトムシート下端が隠れる既知の罠を避けるため、`createPortal(body)` + `.modal-overlay-h`（svh）の形にする。添付が多い場合にリストがはみ出さないよう `flex` + `overflow-y-auto` には `min-h-0` を付ける
- **対応Issue:** #418

### タスク9: 承認フォームとドラフト詳細の改修
- [x] 完了
- **目的:** 通称欄の新設・新項目の表示・`source_mismatch` 警告・訂正版ヒント撤去
- **対応AC:** AC-7, AC-15, AC-16, AC-17, AC-19, AC-34, AC-39
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/components/ApprovalForm.tsx`、`apps/web/src/app/(app)/admin/mail-inbox/components/ExtractedPayloadView.tsx`、`apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx`、同ディレクトリのテスト
- **依存タスク:** タスク1
- **必要なテスト:** 通称「大阪」を入れると各単位が「大阪B」「大阪C」に合成される／単位ごとに個別上書きできる／通称未入力なら合成結果が空（級だけの値が出ない）／`source_mismatch: true` で警告バナーが出て**承認ボタンは押せる**／訂正版ヒントが消えている／旧フィールドを持つ既存ドラフトを開いても壊れない
- **完了条件:** 承認フォーム・詳細画面のテストが green
- **注意:**
  - `composeTitle()` と `title.ts` は**残す**（stem の供給元が AI から人間に変わるだけ）。タスク10 で `DraftCard` が使わなくなるため**本タスク後は `ApprovalForm` が唯一の利用者**になる。死んだコードに見えても削除しないこと
  - 参加費欄は AI が埋めなくなる。手入力できる状態は維持する（自動導出の配線は Non-goals）
  - `capacity_total` は承認時に `events.capacity` へ、級別は従来どおり `capacity_a`〜`e` へ書く
  - `payment_deadline_kind` は承認時に `events.payment_deadline_kind` へマッピングする（「日付あり」→`fixed` /「後日連絡」→`later_notice` /「記載なし」→`unspecified`）
  - `ConfidenceBadge` への参照を外す（**ファイル削除はタスク11**）
- **対応Issue:** #419

### タスク10: 受信箱一覧の整理
- [x] 完了
- **目的:** tier 分けを廃止し、カード表示名を `formal_name` に切り替える
- **対応AC:** AC-18, AC-33
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/page.tsx`、`apps/web/src/app/(app)/admin/mail-inbox/components/DraftCard.tsx`、同ディレクトリのテスト
- **依存タスク:** タスク1
- **必要なテスト:** tier 分けが消え `pending_review` が受信日降順の一本になること／カード表示名が `formal_name`、無い単位は「開催日＋級」になること
- **完了条件:** 一覧のテストが green
- **注意:** `DraftCard` は `composeTitle(stem, grades)` を使わなくなる。`ConfidenceBadge` への参照を外す（**ファイル削除はタスク11**）
- **対応Issue:** #420

### タスク12: イベント側の振込締切状態の表示と編集
- [x] 完了
- **目的:** 承認後も「後日連絡」が失われないよう、申込管理ボード・イベント詳細・イベント編集の3面に反映する
- **対応AC:** AC-42, AC-43, AC-44
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts`・`page.tsx`、`apps/web/src/app/(app)/events/[id]/page.tsx`・`edit/page.tsx`・`actions.ts`、`apps/web/src/components/events/event-form.tsx`・`event-edit-submit.tsx`・`EventLifecycleSection.tsx`
- **依存タスク:** タスク7
- **必要なテスト:** ボードで `payment_deadline: null` かつ `later_notice` なら「後日連絡」、`unspecified` なら「締切未設定」と出し分かれること／編集フォームで状態を変更できること／**日付を入力するとサーバー側で `fixed` に正規化されること**／詳細画面で日本語表示されること
- **完了条件:** 申込ボード・イベント詳細・イベント編集のテストが green
- **注意:**
  - 現状 `entry-board-utils.ts:624` が `build('支払締切', item.paymentDeadline, todayStr, '締切未設定')` で null を一律「締切未設定」にしている。ここが問題の症状そのもの
  - DB は英語値、**UI は日本語表示**（`fixed`→日付そのもの / `later_notice`→「後日連絡」/ `unspecified`→「締切未設定」）
  - 正規化はサーバー側で行う。クライアント側のバリデーションだけに頼ると CHECK 制約違反で 500 になる
- **対応Issue:** #422

### タスク11: `ConfidenceBadge` の削除と参照ゼロ確認
- [x] 完了
- **目的:** 参照が無くなったコンポーネントを消す
- **対応AC:** AC-33, AC-38
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/components/ConfidenceBadge.tsx`（削除）、`apps/web/src/app/(app)/admin/mail-inbox/components/CorrectionHint.tsx`（削除）
- **依存タスク:** タスク9, タスク10
- **必要なテスト:** なし（削除タスク）
- **完了条件:** `git grep ConfidenceBadge` と `git grep CorrectionHint` が 0 件、型チェック・lint 通過
- **追記（実装中に判明）:** `CorrectionHint.tsx` も参照ゼロになった。AC-19（訂正版ヒント撤去）をタスク1 で実施した直接の結果なので、同じタスクでまとめて消す
- **対応Issue:** #421

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1**: タスク1(#411), タスク2(#412), タスク3(#413)（互いに依存なし・変更領域が重ならない）
- **Wave 2**: タスク4(#414), タスク5(#415)（それぞれ `prompt.ts` / `anthropic.ts` で領域が分離）
- **Wave 3**: タスク6(#416)
- **Wave 4**: タスク7(#417)
- **Wave 5**: タスク8(#418)
- **Wave 6**: タスク9(#419), タスク10(#420), タスク12(#422)（mail-inbox 配下と events/entries 配下で領域が分離）（`[id]/page.tsx`＋`ApprovalForm.tsx` と `page.tsx`＋`DraftCard.tsx` で分離）
- **Wave 7**: タスク11(#421)

## 実装外の残作業（出荷後）

- 本番 `.env` の `MAIL_WORKER_PDF_SIZE_LIMIT_KB` を確認する（未設定なら既定 8000 が効く。明示設定されていれば書き換えが必要）
- 本番 migration の適用は `db:migrate`（`db:push` は対話プロンプトで詰まるため使わない）
- `.claude/memory/hub_mail_attachments.md` の「mail-inbox-mailer は実装未着手」は事実と異なるため修正する
