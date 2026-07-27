---
status: completed
---
# entry-form-autofill 実装手順書

要件 = [requirements.md](requirements.md)（AC は §4）／視覚の正 = [design-mock/](design-mock/)（design-spec の忠実度チェックリストが完了ゲート）。

## 共通の技術前提

- **migration は 0050 から**（0049 が最新。並行ブランチなし確認済み 2026-07-27）
- web→mail-worker import は既存パターン（mail-inbox の reextract が先例）。ただし本機能の IMAP は **APPEND 専用の新規薄モジュールを apps/web 側に置く**（mail-worker の imap-client は fetch 専用のため触らない）
- **送信系依存（nodemailer/SMTP）は追加しない**。MIME は `lib/entry-form/mime.ts` で自前組立（multipart/mixed・UTF-8・RFC2047 ヘッダ・base64 添付）
- AI は `@anthropic-ai/sdk` + `claude-haiku-4-5-20251001`。呼び出しは forced tool use（mail-worker の anthropic.ts と同型）
- テスト fixture の xlsx は**実テンプレの構造だけを openpyxl/exceljs スクリプトで合成**する（docs/調査用の実ファイルは実名 PII を含むためリポジトリへコミットしない）
- セルマップの共通表現（ヒューリスティック／AI／手動修正が同じ型を使う）:
  ```ts
  interface CellMapSheet {
    sheetName: string
    targetGrades: Grade[] | null   // 複数シート型の振分先。単一シートは null
    startRow: number
    columns: Partial<Record<MemberField, string>>  // 'familyName' -> 'F' など
    headerCells: Partial<Record<HeaderField, string>> // 'clubName' -> 'F4' など
    danFormat: 'n段' | '漢数字' | ...  // 入力規則リストから判定
  }
  ```

## 実装タスク

### タスク1: スキーマ追加（app_settings / entry_form_drafts）+ migration 0050
- [x] 完了
- **目的:** 会定数の保存先と作成履歴（生成 xlsx bytea 含む）の DB 基盤
- **対応AC:** AC-1, AC-17（基盤）
- **主な変更領域:** `packages/shared/src/schema/app-settings.ts`（新規・key-value: key PK / value / updated_at / updated_by SET NULL）、`packages/shared/src/schema/entry-form-drafts.ts`（新規: entry_group_id FK **CASCADE**・created_by SET NULL・to_email/subject/body/attachment_filename・xlsx bytea（mail-attachments.ts の customType 先例を踏襲）・member_count・status enum('created','imap_failed')・imap_error・created_at。group→最新行引き当ての index）、`packages/shared/src/schema/index.ts`、`packages/shared/drizzle/0050_*.sql`
- **依存タスク:** なし
- **必要なテスト:** schema smoke（既存の migration テスト方式に倣う。テスト DB 再作成の注意 = feedback_drizzle_kit_push_prompt）
- **完了条件:** migration 適用成功・typecheck green
- **対応Issue:** #382

### タスク2: セルマップ推定（ヒューリスティック）+ 合成 fixture
- [x] 完了
- **目的:** テンプレ xlsx からヘッダ行・列対応・記入開始行・複数シート振分・段位表記形式を推定する純ロジック
- **対応AC:** AC-6, AC-11（判定部）
- **主な変更領域:** `apps/web/src/lib/entry-form/cell-map.ts`（型 + ヒューリスティック: 「参加級/段位/姓/名/ふりがな/氏名/出場回数/備考」キーワード探索・入力規則リスト読取・シート名/固定値からの対象級判定・ヘッダ欄（都道府県/所属会名/責任者/電話/E-Mail/振込名義人）検出・「申込先」メールアドレス regex 抽出）、`apps/web/src/lib/entry-form/__fixtures__/`（合成 xlsx 生成スクリプト＋生成物: 標準型/姓名結合型/複数シート型/変形型の4系統）
- **依存タスク:** なし（Wave 1）
- **必要なテスト:** fixture 4系統で列対応・開始行・振分・段位形式・申込先抽出が期待どおり（テストファースト）
- **完了条件:** vitest green・変形型は「低信頼」を返す（AI フォールバック判定に使う）
- **対応Issue:** #383

### タスク3: メール定型・MIME 組立・IMAP APPEND
- [x] 完了
- **目的:** 件名/本文の定型生成（級別人数集計込み）と、送信機構を持たない下書き作成経路
- **対応AC:** AC-14, AC-15, AC-16（構造）
- **主な変更領域:** `apps/web/src/lib/entry-form/mail-template.ts`（定型件名/ファイル名プレフィックス/本文。宛名は organizer_text から）、`apps/web/src/lib/entry-form/mime.ts`（自前 MIME: UTF-8 text + xlsx base64 添付 + RFC2047）、`apps/web/src/lib/entry-form/imap-draft.ts`（imapflow で `Draft` へ APPEND・\Draft フラグ。YAHOO_IMAP_* は mail-worker の loadImapConfig を import して再利用）、`apps/web/package.json`（imapflow 依存追加）
- **依存タスク:** なし（Wave 1）
- **必要なテスト:** 定型生成のスナップショット・MIME 構造（ヘッダ/boundary/base64 復号一致）・APPEND はモック ImapFlow で呼出引数検証
- **完了条件:** vitest green・SMTP 系依存ゼロ（package.json diff で確認）
- **対応Issue:** #384

### タスク4: xlsx 記入エンジン（exceljs fill）
- [x] 完了
- **目的:** CellMap + 会員データ + 会定数から記入済み xlsx を生成（数式・結合セル・入力規則を保持）
- **対応AC:** AC-10, AC-11（記入部）
- **主な変更領域:** `apps/web/src/lib/entry-form/fill.ts`（明細行記入・複数シート振分・ヘッダ欄記入・段位整形（danFormat 準拠、dan NULL/0=無段）・数式セルスキップ）、`apps/web/package.json`（exceljs 依存追加）
- **依存タスク:** タスク2（CellMap 型・fixture を使う）
- **必要なテスト:** fixture へ記入→再読込で「対象セルに期待値・数式/結合/入力規則が無傷・数式セル未上書き」を検証
- **完了条件:** vitest green
- **対応Issue:** #385

### タスク5: AI フォールバック（Haiku）: セルマップ推定＋指定抽出
- [x] 完了
- **目的:** ヒューリスティック低信頼時のセルマップ推定と、主催者指定（件名・ファイル名・申込先）の抽出
- **対応AC:** AC-7, AC-12（AI 部）, AC-13
- **主な変更領域:** `apps/web/src/lib/entry-form/ai-extract.ts`（@anthropic-ai/sdk・claude-haiku-4-5-20251001・forced tool use・入力=シートのテキスト表現＋案内メール本文・出力=CellMap 断片＋指定件名/ファイル名/申込先。API エラー時は「推定不可」を返しフローは手動マッピングへ）
- **依存タスク:** タスク2（CellMap 型）
- **必要なテスト:** SDK モックで出力パース・検証エラー・API エラー時のフォールバック挙動
- **完了条件:** vitest green（実 API 呼び出しなし）
- **対応Issue:** #386

### タスク6: 会定数 settings lib + S3 設定ページ
- [x] 完了
- **目的:** 会の定数6項目の読み書きと設定ハブ配下の編集画面
- **対応AC:** AC-1, AC-2（S3 分）
- **主な変更領域:** `apps/web/src/lib/entry-form/settings.ts`（app_settings の get/set・キー定義）、`apps/web/src/app/(app)/settings/entry-form/page.tsx` + `actions.ts`（admin/vice_admin ガード）、`apps/web/src/app/(app)/settings/page.tsx`（adminLinks に「申込書設定」追加）
- **依存タスク:** タスク1
- **必要なテスト:** action の認可（一般会員 403）・保存→再読込・設定ハブのリンク表示
- **完了条件:** vitest green・視覚 = s3-settings.html 準拠
- **対応Issue:** #387

### タスク7: S2 プレビュー画面（3ステップウィザード）+ Server Actions
- [ ] 完了
- **目的:** 機能の中心。テンプレ選択→列対応確認→会員編集→メール確認→下書き作成の一連
- **対応AC:** AC-2, AC-3（遷移先）, AC-4, AC-5, AC-8, AC-9, AC-12, AC-13, AC-15, AC-17, AC-18
- **主な変更領域:** `apps/web/src/app/(app)/admin/entry-form/[groupId]/`（page.tsx / EntryFormWizard.tsx ほかクライアント一式・actions.ts）。actions: ①初期データ（グループ・添付候補=tournamentDraftId→mail_messages→mail_attachments(.xlsx)・attend=true 和集合・出場回数=appearance-counts(基準日=当日JST)）②テンプレ解析（タスク2/5 を呼ぶ。手動アップロード受口含む）③かな書き戻し（users の kana 4フィールドのみ）④下書き作成（fill→**entry_form_drafts へ保存（IMAP 前）**→MIME→APPEND→status 更新。失敗時 imap_failed + エラー返却）⑤生成 xlsx ダウンロード。UI はボトムシート規約（createPortal(body)+svh）踏襲
- **依存タスク:** タスク1〜6 すべて
- **必要なテスト:** actions 単位（認可・候補列挙・和集合/重複排除・書き戻し・作成成功/IMAP 失敗の履歴 status）＋ウィザードの主要分岐（警告表示・AI バッジ・編集シート）のコンポーネントテスト
- **完了条件:** vitest green・視覚 = b-step1/2/3・b-step1-multisheet/aifallback・b-step2-edit・b-done/b-error 準拠
- **対応Issue:** #388

### タスク8: S1 進行管理への導線 + 履歴表示/再DL + 仕上げ
- [ ] 完了
- **目的:** イベント詳細からの入口と作成履歴の見える化。忠実度チェックリストの最終確認
- **対応AC:** AC-3, AC-17（表示分）, AC-19, AC-20
- **主な変更領域:** `apps/web/src/components/events/EventLifecycleSection.tsx`（「申込書」行: 未作成→作成リンク／作成済→pill+日時作成者+ファイル名/DL+再作成。kind=individual のみ・admin のみ）、`.env.production.example` と `docker/docker-compose.yml` の web サービスへ YAHOO_IMAP_* 追記（**本番 .env への実値反映は出荷後の手作業 DoD として PR に明記**）
- **依存タスク:** タスク7
- **必要なテスト:** 行表示の条件分岐（未作成/作成済/一般会員非表示/team 非表示）・既存 lifecycle テストの回帰 green
- **完了条件:** vitest green・design-spec §忠実度チェックリスト全項目クリア・`git grep DESIGN-PROTO` 対象外（Path D のため不要）
- **対応Issue:** #389

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1:** タスク1, タスク2, タスク3（互いに独立: shared スキーマ / lib(cell-map+fixture) / lib(mail+mime+imap)。変更領域が重ならない）
- **Wave 2:** タスク4, タスク5, タスク6（タスク4/5 は cell-map 型に依存・タスク6 はスキーマに依存。3つは互いに別ファイル）
- **Wave 3:** タスク7（全部に依存・単独）
- **Wave 4:** タスク8（タスク7 の後・単独）

## デプロイ考慮事項（/ship 時の残 DoD 候補）

- 本番 web コンテナへの `YAHOO_IMAP_HOST/PORT/USER/APP_PASSWORD` 追加（compose 変更は PR に含む・実値は本番 .env へ手作業）→ AC-21 の実機確認とセットで消化
