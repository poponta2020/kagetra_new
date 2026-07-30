# メール取込・AI振り分け（mail-worker）

> **責務:** Yahoo!JAPAN Mail IMAP からの大会案内メール取込・AI（Claude/Anthropic）による大会案内抽出・管理者承認・受信箱 UI・添付ファイルのアプリ内プレビュー配信の仕様
> **関連画面:** `/admin/mail-inbox`（受信箱一覧・トリアージ）、`/admin/mail-inbox/mail/[id]`（メール詳細・処理アクション）、`/admin/mail-inbox/[id]`（AI 抽出ドラフトの承認/却下/紐付け）、`/admin/mail-inbox/attachments/[id]`（添付ファイルのアプリ内ビューア）
> **主要実装:**
> - `apps/mail-worker/src/index.ts`（dispatcher CLI。`--mode=fetch-only` / `--mode=extract-only`）
> - `apps/mail-worker/src/pipeline.ts`（`runPipeline` / `runOnce` / `runManualExtract`）
> - `apps/mail-worker/src/jobs.ts`（`mail_worker_jobs` キュー操作）
> - `apps/mail-worker/src/config.ts`（env スキーマ・PDF コストガード・Web Push 設定）
> - `apps/mail-worker/src/fetch/`（`fetcher.ts` / `imap-client.ts` / `pre-filter.ts`）
> - `apps/mail-worker/src/extract/`（`orchestrator.ts` / `pdf.ts` / `docx.ts` / `doc.ts`）
> - `apps/mail-worker/src/classify/`（`classifier.ts` / `schema.ts` / `prompt.ts` / `title.ts` / `cost.ts` / `llm/`）
> - `apps/mail-worker/src/roster-import/`（名簿候補判定・全シート解析・ドラフト生成）
> - `apps/mail-worker/src/persist/`（`mail-message.ts` / `attachment.ts` / `draft.ts`）
> - `apps/mail-worker/src/notify/`（`orchestrator.ts` / `line.ts` / `message-templates.ts` / `web-push.ts`）
> - `apps/mail-worker/src/reextract.ts`（`reextract` CLI）
> - `apps/web/src/app/(app)/admin/mail-inbox/page.tsx`（受信箱一覧）
> - `apps/web/src/app/(app)/admin/mail-inbox/mail/[id]/page.tsx`（メール詳細）
> - `apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx`（ドラフト承認詳細）
> - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（Server Actions）
> - `apps/web/src/app/(app)/admin/mail-inbox/linkable-events.ts`
> - `apps/web/src/app/(app)/admin/mail-inbox/attachments/[id]/page.tsx`（添付アプリ内ビューア）
> - `apps/web/src/app/(app)/admin/mail-inbox/components/`（一覧・詳細の各 UI パーツ）
> - `apps/web/src/app/api/admin/mail/attachments/[id]/route.ts`（添付バイナリ配信）
> - `apps/web/src/app/api/admin/mail/attachments/[id]/preview/[page]/route.ts`（添付プレビュー JPEG 配信）
> - `apps/web/src/app/api/admin/mail/unprocessed-count/route.ts`（未処理バッジ件数）
> - `apps/web/src/app/api/admin/mail-inbox/[id]/draft-status/route.ts`（AI 抽出進行 polling）
> - `apps/web/src/lib/mail-body-cleaner.ts` / `mail-body-image-render.ts` / `attachment-image-render.ts` / `attachment-preview.ts` / `image-cache.ts` / `text-splitter.ts`
> - `packages/shared/src/schema/mail-messages.ts` / `mail-attachments.ts` / `attachment-share-tokens.ts` / `mail-worker.ts`（`mail_worker_runs` / `mail_worker_jobs`）

## 機能仕様

### 全体フロー

Yahoo!JAPAN Mail (IMAP) → `mail-worker`（fetch → 事前ノイズフィルタ → 添付テキスト抽出 → 永続化）→ 管理者が受信箱で個別に AI 抽出を起動 → Claude (Anthropic) が大会案内か否かを判定し開催日ごとのイベント単位に構造化 → 管理者が `/admin/mail-inbox` で承認・却下・既存イベントへの紐付けを行う。承認されたイベントは `events` テーブルへ materialize され、LINE 自動配信がトリガされる（配信自体の仕様は [spec/notifications.md](notifications.md)）。

`mail-worker` は本番では systemd timer から起動される CLI（`apps/mail-worker/src/index.ts`）で、常駐プロセスではない。2 つの独立した timer が同じバイナリを異なる `--mode` で呼ぶ:

- **fetch dispatcher**（既定 `--mode=fetch-only`、cron 定期）: IMAP から新着を取得し `mail_messages` / `mail_attachments` に永続化するだけで、**AI 抽出は呼ばない**（旧仕様の「取得したら即 AI 判定」は廃止された）。`mail_worker_jobs` の `kind='fetch'` ジョブ（管理者による手動取得トリガ）もこの dispatcher が拾う。
- **extract-only dispatcher**（`--mode=extract-only`、30 秒間隔 timer）: IMAP fetch を一切行わず、`mail_worker_jobs` の `kind IN ('manual_extract', 'result_parse', 'roster_parse')` を 1 tick 1 件だけ claim して実行する。`manual_extract` は本ドメインの AI 抽出、`result_parse` は結果 Excel の決定的パース、`roster_parse` は添付または本文からの名簿ドラフト生成を担う。名簿解析だけの tick では Anthropic 設定を要求しない。

`--mock-imap` / `--mock-llm` / `--dry-run` / `--no-claim` フラグでテスト・スモーク実行を切り替えられる（`apps/mail-worker/src/index.ts` の `printUsage()` 参照）。通常取得は `--mailbox` 省略時に `INBOX`、`--since` 省略時に直近 7 日分を使う。過去フォルダ調査は `--mailbox`、`--from-year`、`--to-year`、`--max-roster-candidates`、`--max-roster-ai-calls`、`--resume-after-uid` で取得範囲・処理上限・再開位置を固定できる。過去フォルダの `--dry-run` はDB書込・添付抽出・AI呼出を行わず、`lottery backfill report`（候補、決定的分類成功、要確認、失敗、次回カーソル）をJSONで返す。分類成功は級と名簿用途の推定が揃ったという意味であり、ドラフト承認・公開済みを意味しない。レビュー対象をDBへ用意する書込み実行では `--once --stage-roster-drafts` を明示し、候補原本ごとに名簿ドラフトを冪等生成する。`--stage-roster-drafts` は `--dry-run` と併用できず、ドラフト生成失敗時は再開カーソルを失敗UIDより先へ進めない。

### 取得（fetch）

`apps/mail-worker/src/fetch/imap-client.ts` の `ImapClient` が imapflow 経由で Yahoo IMAP に接続し、`mailparser` で RFC 822 を1通ずつパースする。`ParsedMailMeta` に正規化されたヘッダー（キーは小文字）・本文（text/html 両方）・添付一覧を持つ。添付は以下を `attachmentSkips` として弾く（`ParsedAttachmentSkip.reason`）:

- `no_filename`: ファイル名ヘッダーが無い添付
- `inline_referenced`: HTML の `cid:` 参照によるインライン画像（newsletter バナー等をため込まない）
- `oversized`: `MAX_ATTACHMENT_BYTES`（30 MB）超過

Message-ID が無いメールはパース失敗として `FetchedMailError`（`stage: 'parse_failed'`）に積まれ、バッチ全体を止めない。`mail_messages.message_id` の UNIQUE 制約による `ON CONFLICT DO NOTHING`（`persist/mail-message.ts`）が冪等性の最終防衛線で、同一ウィンドウを cron が再取得しても重複挿入されない。

### 抽選名簿の過去バックフィル運用

初期バックフィルは mailbox×受信年を1バッチとし、必ず同じ引数の `--dry-run` から始める。候補上限で次バッチが残る場合、レポートの `resume.nextAfterUid` を次回の `--resume-after-uid` に渡す。IMAP取得・パース失敗がある場合はカーソルをそのUIDより先へ進めず `blockedByFailure=true` とするため、原因を解消して同じカーソルから再実行する。Message-ID一意制約と原本単位のドラフト一意制約により同じ入力の再実行は冪等である。

`--lottery-coverage-report` はDBを変更せず、2024年度以降（`--from-year` / `--to-year` で変更可）の開催回について、大会区分不明数、開催日不足、対象級未設定、公認・新春の開催済み回数、対象級ごとの確定名簿原本・active実出場原本の有無を協会年度別JSONで返す。対象級は `events.eligible_grades` を正とし、存在する原本の級から逆算しない。協会年度は開催日を3か月戻した年で判定し、開催日が取れない回はedition年へ仮置きしたうえで `missingReferenceDate` として不完全扱いにする。`unknown`を公認扱いへ推定せず、いずれかの不足があれば `complete=false` とする。実運用コマンド、出力保存、承認ゲートは [data-quality/tournament-lottery-backfill.md](../data-quality/tournament-lottery-backfill.md) を正典とする。本番migration、非dry-run取得、ドラフト一括生成、採用はそれぞれ別の明示承認が必要で、このCLIの実装完了だけでは実行しない。

`fetch/pre-filter.ts` の `shouldSkipByHeaders()` はヘッダーベースのノイズ判定（`Auto-Submitted` / `Precedence: bulk|junk` / `X-Spam-Flag` / `X-Spam-Status` / `List-Unsubscribe` かつ `List-Id` 欠如）。該当メールは `mail_messages.classification='noise'` で永続化されるが行自体は残す（誤判定を運用者が確認できるように）。正規のメーリングリストヘッダー（`Precedence: list` や `List-Id` 付き `List-Unsubscribe`）は意図的にスキップ対象から除外している（taikai-ajka 等の大会案内 ML を取り込むため）。

### 添付テキスト抽出

`extract/orchestrator.ts` の `extractAttachment()` が content-type（不明瞭な場合はファイル拡張子）でルーティングする:

- PDF (`application/pdf` 等) → `extract/pdf.ts`
- DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) → `extract/docx.ts`
- 旧 Word (`application/msword`、`.docx` 拡張子なら DOCX 扱い） → `extract/doc.ts`（`word-extractor` で OLE コンテナを解析）
- XLSX は意図的に**非対応**（`xlsx@0.18.5` の未パッチ脆弱性を踏まえたリスク受容）。バイナリは保存されるが `unsupported` のまま

抽出失敗は例外を投げず `{ status: 'failed', reason }` に落ちる（1 添付の壊れたファイルでバッチ全体を止めない）。空テキスト抽出（画像のみの PDF 等）は `status: 'extracted', text: ''` として扱い、AI フェーズでは PDF の場合ネイティブ document block（後述）にフォールバックする。

### AI 抽出（手動起動・cron では起動しない）

以前は fetch cron が全新着メールに対して自動で AI 判定していたが、現在は**管理者が受信箱詳細で「会で流す（AI 抽出）」を明示的に押した時のみ**起動する（`triggerExtractDraft` Server Action、`apps/web/src/app/(app)/admin/mail-inbox/actions.ts`）。この Server Action は 1 トランザクションで:

1. `tournament_drafts` へ `status='ai_processing'` の行を UPSERT（既存 `ai_failed` はリセットして再利用、`ai_processing` 中の重複起動はエラー）
2. `mail_worker_jobs` へ `kind='manual_extract'`, `payload={mail_message_id}` を INSERT

「会で流す（AI 抽出）」は**添付選択ダイアログ**（`AIExtractConfirmDialog`）を経由する。添付をファイル名・種別・サイズ付きで一覧し、**既定は全て未チェック**。サイズ上限（`MAIL_WORKER_PDF_SIZE_LIMIT_KB`）を超える PDF はチェックできない。添付が1件以上あるのに全て未チェックのまま実行しようとすると「本文だけで実行しますか？」の確認を1段挟む（添付0件のメールでは挟まない）。同じダイアログをドラフト詳細の「再 AI 抽出」でも使い、**前回の選択を初期値として復元**する（復元時は現在のサイズ上限で正規化し、上限を超えた／削除された添付は選択から落として警告する —— 外せないチェックが残ると再抽出が詰むため）。

選択は `tournament_drafts.selected_attachment_ids`（`integer[]`、NULL = 旧データ／未指定＝全添付）に永続化する。書き込みは**ジョブ enqueue より前**に同一トランザクションで行う —— ワーカーはジョブ実行時にこの列を読むので、順序が逆だと NULL を読んで全添付を送ってしまい、エラーも出ないまま機能が死ぬ。Server Action は UI を経由しない不正な選択を拒否する: **当該メールに属さない添付 id**（`mail_message_id` で絞ったクエリで存在確認する。他メールの添付を読ませられるのは情報漏洩）と、**サイズ上限超過の PDF**、そして**選択の合計サイズ超過**。検証は既存の `FOR UPDATE` トランザクション内で行い、多重起動ガードを弱めない。

extract-only dispatcher（30 秒間隔）がこのジョブを claim し、`pipeline.ts` の `runManualExtract()` を実行する（この関数が draft 行から選択を読んで `classifyMail` へ渡す。`reextractDraft` はこの経路を通らず `classifyMail` を直接呼ぶので、Server Action 側で明示的に渡している）。詳細画面はこの間 `ExtractionInProgressCard`（`apps/web/src/app/(app)/admin/mail-inbox/components/ExtractionInProgressCard.tsx`）を表示し、`/api/admin/mail-inbox/[id]/draft-status` を 3 秒間隔で polling して `pending_review` / `ai_failed` / `approved` / `rejected` への遷移を検知したら `router.refresh()` する。完了時は Web Push（`notify/web-push.ts` の `notifyExtractCompleted`、VAPID 未設定なら best-effort でスキップ）で「AI 抽出完了」/「AI 抽出に失敗」を通知する。

`classify/classifier.ts` の `classifyMail()` がコア処理:

1. `mail_messages` + `mail_attachments`（`data` を含む）を読み、pre-filter noise なら `force:true` でない限り即 `skipped_noise` を返す
2. **添付選択の適用**: `ClassifyOptions.selectedAttachmentIds` で対象添付を絞る。3 状態で、`tournament_drafts.selected_attachment_ids` 列とそのまま対応する —— `undefined`/`null`＝未指定（旧データ含む。全添付を送る）、`[]`＝「本文だけで実行」という明示的な選択（**早期 return せず**添付ゼロで LLM を呼ぶ）、非空配列＝その id だけ。**本文（`bodyText ?? bodyHtml`）は選択によらず常に渡る**
3. **PDF コストガード**: `MAIL_WORKER_PDF_SIZE_LIMIT_KB`（既定 8000 KB。`0` で無効化）を超える PDF 添付が**選択後の集合に**あれば AI 呼び出し自体をスキップし `oversize_skipped` を返す。上限超過は選択ダイアログの時点でブロックされるため正常系では到達しないが、Server Action 直叩き・多重タブへの防御として意図的に残している。あわせて**合計サイズ**も見る（`classify/attachment-budget.ts` の `ATTACHMENT_TOTAL_LIMIT_BYTES` = 20MB）—— 1件ごとの上限を全て満たしていても、複数選べば合計は Anthropic のリクエスト上限 32MB を超え得る（PDF は base64 で約 4/3 に膨らむ）。超えたリクエストは 413 `request_too_large` で確実に失敗する。合計ガードは Server Action・選択ダイアログでも同じ関数を共有するが、**選択が未指定（NULL）の経路**——大きな PDF を何件も持つ古いメールを reextract CLI にかける——では classifier 側が唯一の砦になる
4. 添付を LLM 入力へ整形: PDF はネイティブ document block（base64。`bytesFromBytea()` が bytea の hex-escape 文字列 vs 生 Buffer の差異を吸収）、DOCX/DOC 等の抽出済みテキストはそのままテキストブロック。`unsupported`/`pending` の行は呼び出し時点でその場限りの再抽出フォールバックを試みる（DB は更新しない）
5. `LLMExtractor.extract()`（既定 `AnthropicExtractor`、`classify/llm/anthropic.ts`）を呼び、失敗（`LLMNoToolUseError` / Zod 検証失敗）したら 1 回だけリトライ。2 回とも失敗なら `kind: 'failed'` を返す
6. 成功すれば常に `tournament` を返す。**AI は「大会案内かどうか」を判定しない**（管理者が押した時点でその判断は済んでいる）

**モデルは `claude-sonnet-5`**。`thinking: { type: 'disabled' }` を**明示的に指定する** —— Sonnet 5 は省略時に adaptive thinking が ON になり、`max_tokens` が思考と出力を合算して上限をかけるため、明示しないと `record_extraction` の引数が途中で切れる。構造化抽出に思考は不要。**プロンプトキャッシュは使わない**（手動起動＝メール1件ごとの散発的な呼び出しになり、どの TTL でもヒットせず書込プレミアムだけを払うため）。

`classify/schema.ts` の `ExtractionPayloadSchema`（Zod）が LLM 出力の契約。**PROMPT_VERSION 3.0.0** で分類がスキーマから撤去された（`is_tournament_announcement` / `confidence` / `short_name_stem` / `is_correction` / `references_subject` / `fee_jpy` を削除）。全体項目は `reason`（レビュー画面向けの抽出メモ）/ `source_mismatch`（渡された資料が明らかに別種の文書のときだけ true。**分類の別名ではない**）/ `events[]` / `extras`（`eligible_grades_raw` と `target_grades_raw` のみ）。`EventUnit` には `payment_deadline_kind`（「日付あり」「後日連絡」「記載なし」の3値。振込締切が空の理由を機械的に区別する）と `capacity_total`（全体定員）が加わり、`payment_method` / `entry_method` は閉じた日本語 enum になった。全体定員と級別定員は**互いに独立に抽出**し、どちらの方向にも逆算・均等割り・合算をしない。

同日複数級は 1 単位に `eligible_grades` として連ねる／級ごとに開催日が違えば単位を分ける、というルールは `classify/prompt.ts` のシステムプロンプトで指示される。表示用の大会名（`events.title`）は AI が出力せず、**承認フォームで管理者が入力した通称**を種に `classify/title.ts` の `composeTitle(stem, grades)` が固定 A→E 順でサフィックスを合成する（3.0.0 で stem の供給元が AI から人間に変わった。合成ロジック自体は不変）。

`classify/cost.ts` の `calculateCostUsd()` が Anthropic の usage（`input_tokens` / `output_tokens` / キャッシュ read・write）から USD を算出し `tournament_drafts.ai_cost_usd` に保存される。単価は Sonnet 4.6 と同一だが、2026-08-31 までの導入価格期間中は実請求より高く記録される。キャッシュ撤去によりキャッシュ系トークンは常に 0。

`persistOutcome()`（`classify/classifier.ts`）が `ClassifyOutcome` を DB へ反映する一本化された書き込みパス（pipeline / `runManualExtract` / `reextractDraft` / `reextract` CLI が全て共有）:

- `tournament` → `tournament_drafts` を `status='pending_review'` で upsert、`mail_messages.classification='tournament'`, `status='ai_done'`
- `noise` → 新規 draft は作らず `mail_messages.classification='noise'`, `status='ai_done'`。既存の `pending_review`/`ai_failed` draft があれば `superseded` に落とす（`approved`/`rejected` は人間の判断として保護し触らない）
- `failed` → `tournament_drafts` を `status='ai_failed'` で upsert（生レスポンス・失敗理由を保持）、`mail_messages.status='ai_failed'`
- `oversize_skipped` → draft は作らず `mail_messages.status='oversize_skipped'`
- `skipped_noise` → 何もしない（pre-filter が既に処理済み）

`persist/draft.ts` の `upsertDraft()` は `tournament_drafts.message_id`（UNIQUE）を SELECT-then-INSERT-or-UPDATE で扱い、既存行が `approved`/`rejected`（運用者が確定した終端状態）なら書き込みを **preserve**（無視）する。これにより再抽出やモデル更新が人間の承認済み判断を上書きしない。

`reextract.ts`（CLI、`apps/mail-worker/src/reextract.ts`）はプロンプト更新・モデル更新後の一括再分類ツール。`--since=YYYY-MM-DD` 必須、既定は `ai_done`/`ai_failed`/`archived`/`ai_processing`/`oversize_skipped` の terminal 状態を対象に `force:true` で `classifyMail` を再実行する。`--include-prefilter-noise` で pre-filter が弾いた行（`status='fetched', classification='noise'`）も対象に含められる。個別ドラフト単位の再抽出は Web UI から `reextractDraft` Server Action（承認済み単位が 1 件でもあれば拒否）でも起動できる。

### 訂正版の扱い

**AI は関与しない。** 訂正版メールはほぼ届かず、届いても差分は軽微（締切の変更等）なので、管理者が本文を読んで該当する既存イベントを手動で編集する運用にしている。PROMPT_VERSION 3.0.0 で `is_correction` / `references_subject` を出力スキーマから削除し、承認画面の訂正版ヒント（関連ドラフト・関連イベントの ILIKE 検索）も撤去した。

`tournament_drafts.is_correction` / `references_subject` **列は残っている**が、書き込みは止まっている（既存行の値はそのまま）。承認後の LINE 配信文言の `【訂正】` プレフィックスはこの列を読む経路が残っているため、AI 由来の新規ドラフトでは付かない（[spec/notifications.md](notifications.md)）。

### 運用者向け通知（システムアラート）

`notify/` 配下は**管理者への運用アラート**であり、承認後の会員向け LINE 配信（`line-broadcast.ts`、[spec/notifications.md](notifications.md)）とは別レイヤ。`notify/line.ts` は `line_channels.status='system'` の 1 チャンネルを使い、`notify/orchestrator.ts` の `evaluateAndNotify()` が `mail_worker_runs` の直近 3 件を見て次を判定する:

- 新規ドラフト作成（`drafts_created > 0`）→ 毎回 push（件名トップ 5 + 残数）
- IMAP 連続失敗 3 回 → アラート push（`notified_imap_alert` フラグで連投抑制）
- AI 連続失敗（直近 3 run すべてで失敗かつ累計 3 件以上）→ アラート push（`notified_ai_alert` で連投抑制）

LINE SDK の例外は `LineNotifyError` にラップして catch され、通知失敗はパイプライン成功を巻き込まない（`LINE_NOTIFY_DRY_RUN=1` でテスト時は実送信をスキップ）。

mail-triage-badge（未処理バッジ）は別チャネルの Web Push（`notify/web-push.ts`）。新着メール insert 毎（`onMailInserted` フック）と AI 抽出完了時に、`admin`/`vice_admin` 全端末の `push_subscriptions` へ配信する。ペイロードの `badge` は `triage_status != 'processed'` の件数（`/api/admin/mail/unprocessed-count` と同じクエリ）。410/404 応答の購読は失効とみなし削除する。

### 受信箱 UI（`/admin/mail-inbox`）

`admin`/`vice_admin` のみアクセス可（`session.user.role` チェック、`/403` へリダイレクト）。一覧は `mail_messages.triage_status`（`unprocessed`/`processed` の 2 状態。旧「保留」は廃止済み）優先で、未処理を最大 100 件・処理済みを参考として最新 20 件表示する。**未処理内の tier 分けは廃止した**（`confidence >= 0.9` による「要対応 / 要確認 / その他」の3分割）—— `confidence` が抽出スキーマから消え、振り分けの根拠が無くなったため。未処理は**受信日降順の一本**で並ぶ。

各カードは受信日時・分類ピル（`tournament`/`noise`/`unknown`）・技術状態ピル（`mail_message_status` の値）・添付チップ（`AttachmentList`）・draft サマリ（`DraftCard`）を表示する。`DraftCard` の表示名は各単位の **`formal_name`**、無い単位は「開催日＋級」、どちらも無ければ「（名称不明）」。`composeTitle(stem, grades)` は AI が stem を出さなくなったため一覧では使えない（合成そのものは承認フォームで生きている）。画面上部に直近 5 件の `mail_worker_runs`（開始時刻・種別・状態・新規 draft 数）のテーブルがあり、`TriggerFetchButton` から `triggerMailFetch` Server Action（プリセット 24h/3d/7d/custom で `mail_worker_jobs(kind='fetch')` を INSERT）で手動取得をキューできる。

### メール詳細（`/admin/mail-inbox/mail/[id]`）

本文は折りたたみなしで即時表示（`bodyText` 優先、無ければ `bodyHtml` を生テキストとして `<pre>` 表示。HTML はエスケープされ `dangerouslySetInnerHTML` は使わない）。アクションエリアは `triage_status` + `draft.status` で分岐する:

- `processed` → 「未処理に戻す」（`UndoTriageButton`。既存イベント紐付けがあれば同時に解除する旨を注記）
- draft なし → `MailDetailActions` の 3 ボタン: (a) 会で流す（AI 抽出、**添付選択ダイアログ**経由で `triggerExtractDraft`）、(b) 既存イベントに紐付ける（`ExistingEventLinkSheet` → `linkMailToEvent`）、(c) 対応不要（`dismissMail`。未完了 draft がある行は拒否）
- `draft.status='ai_processing'` → `ExtractionInProgressCard`（polling）
- `draft.status='ai_failed'` → 再試行ボタン（`AIExtractConfirmDialog`）
- `draft.status='pending_review'` → `DraftCard` + 承認詳細へのリンク
- `approved`/`rejected`/`superseded` → `DraftCard` + 詳細リンク（読み取り専用）

「既存イベントに紐付ける」候補は、キャンセル済みでなく開催日が「今日以降」または「過去 30 日以内」のイベントに限定される（`linkable-events.ts` の `linkableEventCutoffStr()` / `validateLinkableEvent()` が UI クエリと `linkMailToEvent` Server Action の両方で同じ条件を評価する二重防御）。紐付け時は任意の「冒頭メッセージ」（200 文字以内）を LINE 配信に付加できる。

`.xls`/`.xlsx` 添付がある場合、画面下部に「試合結果の取込」セクションが独立して表示される（`ResultParseButton` → `triggerResultParse` Server Action → `mail_worker_jobs(kind='result_parse')`）。これは AI 抽出フロー（`tournament_drafts`）とは別系統の `result_drafts` を扱い、パース・承認ロジックの詳細は [spec/tournaments-results.md](tournaments-results.md) の管轄。

添付が 1 件でもあると、画面下部に「名簿ファイルの採用」セクションが独立して表示される（`RosterFileAdoptSheet` → `adoptRosterFile` / `releaseRosterFile`）。これは解析せず原本のまま名簿として登録する経路で、`tournament_roster_import_drafts`（決定論パース・AI 抽出）とは完全に独立している —— ドラフトの状態を読まず変えないため、`triage_status` や draft の有無に関わらず常に出る。対象イベント候補は「既存イベントに紐付ける」と同じ `linkable-events.ts` の条件を共有する。採用済みの添付には種別と対象大会が表示され、同じ場所から解除できる。仕様の正典は [spec/tournaments-results.md](tournaments-results.md)「名簿ファイルの採用」。

名簿候補は件名・本文・添付名だけで低コストに判定し、空の申込書や一般案内を除外する。`roster_parse` は `.xls` / `.xlsx` / `.xlsm` の氏名表を全シートから解析し、PDF・Word・本文は既存抽出テキストを確認用ドラフトとして保持する。添付は `source_attachment_id`、本文は `source_mail_message_id` ごとの部分一意制約で冪等化する。構造を確定できない原本は `parse_failed`、正規化氏名の同級重複は行を削除せず `pending_review` の `validationIssues` に残す。採用・訂正フローは tournament-lottery-trends の管理画面仕様が担当する。

### ドラフト承認詳細（`/admin/mail-inbox/[id]`）

`tournament_drafts.status` が `pending_review`/`ai_failed` の間だけ操作ボタン（承認・却下・再抽出・既存イベント紐付け）を表示し、`approved`/`rejected`/`superseded` は読み取り専用ビューに畳む（表示条件はサーバー側の `APPROVABLE_STATUSES` ガードと一致させている）。

画面には `source_mismatch: true`（AI が「渡された資料が明らかに別種の文書に見える」と申告した）のとき警告バナーが出る。ドラフトは通常どおり `pending_review` で作られ、**承認はブロックしない**（人間の判断が AI より上位）。

**承認（`approveDraftUnits`）** は 1 draft : N イベントの複数単位承認 UI（`ApprovalForm`。旧`approveDraft` は 1 draft : 1 event の後方互換経路として残置、DoD 上は新規承認は複数単位経路を使う）。`ApprovalForm` は `EventUnit[]`（新形式）または単一 `extracted` オブジェクト（旧 2.0.0 未満フォーマット、`normalizeUnits()` が単一ユニット `u1` に正規化）を各単位ごとの `EventForm` としてレンダリングする。

タイトルはフォーム上部の**「通称」欄**（人力入力）を種に `composeTitle(通称, eligible_grades)` で合成する。単位ごとに個別上書きでき、上書きした単位は通称の変更に追随しない。通称が未入力のあいだ合成結果は**空**にする（`composeTitle(null, ['B'])` は級だけの「B」を返してしまい、無意味な値のまま登録される事故になるため）。承認時のマッピングで新しいのは `capacity_total` → `events.capacity`（級別は `capacity_a`〜`e` のまま併存）と、`payment_deadline_kind` の日本語3値 → `events.payment_deadline_kind` の英語 enum（[spec/events-attendance.md](events-attendance.md)）。参加費は AI が埋めなくなったが手入力欄は残る。管理者はチェックした単位だけを選んで登録できる（部分承認）。既に materialize 済みの単位は読み取り専用表示。全単位が materialize されて初めて draft を `approved` + mail を `processed`/`archived` に倒す（部分承認中は `pending_review` のまま受信箱に残る）。「残りは作らず完了」（`completeDraft`）は 1 件以上 materialize 済みのときだけ表示され、未登録の残り単位を作らずに draft を閉じる。

承認処理には任意で「開催（edition）への紐付け」チェックがある。承認可能な詳細画面は `tournament_series` を1回読み込み、AI抽出名が正準名または別名に正規化完全一致する系列が1件だけなら、その系列IDと回次を初期選択する。未一致・複数一致ではAI由来の名前を検索語にだけ入れ、系列は未選択にする。

「系列を検索・選択」はモバイル対応のボトムシートで、承認対象と同じ `kind`（個人戦/団体戦）の系列を正準名・別名から正規化部分一致検索する。候補は正準名を主表示し、別名に一致した場合は一致した別名も表示する。検索文字列と選択済み系列を別状態として扱い、既存系列は hidden `editionSeriesId` だけで確定する。0件時だけ検索語を新規系列として作る明示確認を提示し、確認後に限り `editionSeriesName` と `editionCreateNewSeries=on` を送る。

`approveDraftUnits` は draft 行をロックしたトランザクション内で、既存系列IDの存在・`kind` を再検証して `findOrCreateEdition`（`apps/web/src/lib/edition/resolve.ts`）を呼ぶ。検索文字列だけ、既存IDと新規作成の同時指定、改ざんID、種別不一致、正でない回次は拒否する。明示的新規作成名が既存系列の正準名・別名に完全一致する場合も、検索結果から既存系列を選び直すよう拒否する。同一 draft から作る全イベントの `kind` が混在すると拒否し、部分承認では先行・後続どちらで開催を選んでも全イベントを同一 edition へ収束させる（詳細は [spec/tournaments-results.md](tournaments-results.md)）。

承認/却下/紐付け操作はすべて `tournament_drafts` 行を `FOR UPDATE` でロックしてから状態遷移する（並行操作の直列化）。1 件でもイベントを materialize 済みの draft は却下・単純紐付け（`linkDraftToEvent`）ができない（作成済みイベントが孤児化する矛盾を防ぐ）。承認・紐付け成功後は `after()` フックでレスポンスをブロックせずに LINE 自動配信（`broadcastMailToEvent`）を起動する（配信自体は [spec/notifications.md](notifications.md)）。

### 添付ファイルのアプリ内ビューア

添付チップ（`AttachmentList`）は同一ウィンドウ内遷移で `/admin/mail-inbox/attachments/[id]?from=<戻り先パス>` を開く。iOS ホーム画面 PWA では same-origin 遷移がアプリ内 WebView に留まり戻る UI が一切無いため、専用ビューア画面で「✕」（`from` パラメータへ `Link replace` で戻る。`/admin/mail-inbox` 始まりのパスのみ許可しオープンリダイレクトを防ぐ）を提供する。

表示方式は `attachment-preview.ts` の `detectPreviewKind()`（宣言 MIME 優先、`octet-stream` 等の曖昧な型はファイル拡張子で判定。`image` 種別だけは拡張子フォールバック無し）で振り分け:

- `document`（PDF / Office 文書）→ PDF はそのまま、Office は `libreoffice --convert-to pdf`（`forceWriter: false`。Calc/Impress を Writer 扱いにしない）→ `pdftoppm` で JPEG ページ化し `<img>` を縦積み。iOS Safari が iframe 内 PDF を 1 ページ目しか描画しない既知の制限を回避するため
- `image`（jpeg/png/gif/webp/heic/heif）→ バイナリルートをそのまま `<img>` src に
- `text`（text/plain, text/csv）→ bytea を UTF-8 で `<pre>` 表示（100,000 文字上限）
- その他（zip 等）→ プレビュー不可カード + ダウンロードリンク

レンダリング結果は `image-cache.ts` の `globalThis` ピン留めインメモリキャッシュ（Next.js の chunk 分割で Server Component 側と Route Handler 側が別モジュールインスタンスになる問題を回避するための pin。容量上限 200 MB / 500 エントリ、超過分は挿入順で LRU 近似 evict、TTL 24h）に格納される。`RENDER_PAGE_LIMIT`（30 ページ）超過時は `truncated: true` を返し UI が「続きは元ファイルを参照」と案内する。並行する `<img>` フェッチが同一添付の変換を多重起動しないよう、`attachment-preview.ts` は `globalThis` ピン留めの in-flight registry で変換を1本化する。

添付バイナリ配信（`/api/admin/mail/attachments/[id]`）は fail-closed allowlist を実装する: PDF / Office 文書 / ラスタ画像 / プレーンテキストのみ宣言 MIME のまま `inline` で配信し、それ以外（HTML/SVG/XML/JS 等の active content・不明型）は `application/octet-stream` + `Content-Disposition: attachment` に強制ダウングレードする（`X-Content-Type-Options: nosniff` を常に付与）。ページプレビュー配信（`/api/admin/mail/attachments/[id]/preview/[page]`）は常に pdftoppm が生成した JPEG（送信元の危険性に関わらず inert）を返すため MIME allowlist 判断が不要。両ルートとも `admin`/`vice_admin` セッション必須。

添付ファイルは LINE 配信時に `attachment_share_tokens`（`packages/shared/src/schema/attachment-share-tokens.ts`）経由の公開ダウンロードリンクとしても共有される。トークンは添付 1 件につき最大 1 行（60 日 TTL、期限内は再利用、期限切れなら同一行を書き換えて発行し直す）で、`/api/line-broadcast/attachments/[token]` が配信するが、この公開ルートおよび LINE 配信自体の詳細は [spec/notifications.md](notifications.md) の管轄。

### メール本文の LINE 配信向け加工

`apps/web/src/lib/mail-body-cleaner.ts`（`stripMailFooter()` / `buildBroadcastBody()`）は Google Groups 等の自動フッター除去と、件名・訂正フラグを本文先頭に埋め込むテキスト整形を行う。`mail-body-image-render.ts` はメール本文を A4 縦 HTML（`libreoffice --writer` で Web レイアウトのバグを回避）→ PDF → `pdftoppm` で JPEG 化し、LINE 上でスマホスクロールが伸びる問題をスクリーンショット的な 1 枚絵で解消する（要承認済みイベント紐付け後に配信されるため、実際の呼び出し元・配信条件は [spec/notifications.md](notifications.md)）。`text-splitter.ts` の `splitForLine()` は LINE のテキストメッセージ 5000 文字上限に合わせ、段落境界→文境界→ハードカットの順で安全に分割する（サロゲートペアを跨がない）。これら 3 つの lib は本ドメインが提供する加工ユーティリティで、実際の配信トリガー（`broadcastMailToEvent`）は notifications.md 側が呼び出す。

### ジョブキュー・ワーカー運用状態

`mail_worker_jobs`（`kind`: `fetch` / `manual_extract` / `result_parse` / `roster_parse`、`status`: `pending`/`claimed`/`done`/`failed`）は管理者操作起点の非同期実行キュー。`claimNextJob()` は `FOR UPDATE SKIP LOCKED` で単一 dispatcher 前提の安全な claim を行い、`kinds` オプションで dispatcher の `--mode` ごとに拾う種別を絞る。`recoverStaleClaimedJobs()` は worker クラッシュで `claimed` のまま取り残された行を `pending` に戻す（`fetch` 系は 1 時間閾値、`manual_extract`/`result_parse`/`roster_parse` は systemd の `TimeoutStartSec=300` に合わせた 10 分閾値で別途復旧）。

`mail_worker_runs`（`kind`: `cron`/`manual`、`status`: `running`/`success`/`imap_failed`/`ai_failed`/`partial`）は 1 起動 = 1 行。`summary` jsonb に取得件数・分類件数・新規 draft 件数・エラー一覧・アラート済みフラグを保持し、受信箱一覧の「最近の取り込み履歴」テーブルと `notify/orchestrator.ts` の連続失敗検知の両方が同じ行を参照する。

## API（Server Actions / Route Handlers）

`apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（すべて `'use server'`、`requireAdminSession()` で `admin`/`vice_admin` を要求）:

- `approveDraft(draftId, formData)` — 旧 1 draft:1 event 承認経路（後方互換）
- `approveDraftUnits(draftId, formData)` — 複数単位の部分承認・edition 紐付け
- `completeDraft(draftId)` — 1 件以上 materialize 済みの draft を残り単位を作らず完了
- `rejectDraft(draftId, formData)` — 却下（理由必須、materialize 済みがあれば拒否）
- `reextractDraft(draftId)` — 単一ドラフトの再 AI 抽出（materialize 済みがあれば拒否）
- `linkDraftToEvent(draftId, eventId)` — 既存イベントへの単純紐付け
- `dismissMail(mailId)` — 「対応不要」triage（未完了 draft があれば拒否）
- `undoTriage(mailId)` — 処理済み → 未処理へ戻す
- `triggerExtractDraft(mailId)` — 「会で流す（AI 抽出）」。`tournament_drafts` upsert + `manual_extract` ジョブ enqueue
- `linkMailToEvent(mailId, eventId, leadText?)` — 「既存イベントに紐付ける」（draft 経由でない、補足メール向け）
- `unlinkMailFromEvent(mailId)` — 既存イベント紐付けの取り消し（LINE 配信済みメッセージ自体は取り消せない）
- `triggerMailFetch(formData)` — 手動 IMAP 取得ジョブの enqueue（24h/3d/7d/custom プリセット）
- `triggerResultParse(mailId, attachmentId)` / `approveResultDraft(...)` / `rejectResultDraft(...)` — 結果 Excel 取込系。ロジックの正典は [spec/tournaments-results.md](tournaments-results.md)（本ファイルはトリガ導線のみ記述）
- `triggerRosterParse(mailId, attachmentId)` — 対応する添付（Excel/PDF/Word/text）または本文を指定し、同じ原本の未完了ジョブを重複させず `roster_parse` をenqueueする
- `approveRosterImportDraft(draftId, formData)` — 開催・イベント・原本用途・版の扱い・級別factを検証し、ドラフト、roster、publication、級別factを1トランザクションで採用する。検証エラーの残るドラフトは拒否する
- `rejectRosterImportDraft(draftId, reason)` — 承認待ちまたは解析失敗の名簿ドラフトを理由付きで却下する。1メールに複数原本があり得るため、名簿1件の採用・却下だけではメール全体を処理済みにしない

Route Handlers（すべて `admin`/`vice_admin` セッション必須）:

- `GET /api/admin/mail/attachments/[id]` — 添付バイナリ配信（fail-closed allowlist）
- `GET /api/admin/mail/attachments/[id]/preview/[page]` — 添付プレビュー JPEG 配信
- `GET /api/admin/mail/unprocessed-count` — 未処理バッジ件数（PWA フォアグラウンド同期用）
- `GET /api/admin/mail-inbox/[id]/draft-status` — AI 抽出進行状況 polling（`id` は `mail_messages.id`）

mail-worker 側 CLI エントリポイント（Server Action からは呼ばれない、systemd/手動実行専用）:

- `apps/mail-worker/src/index.ts` — dispatcher（`--mode=fetch-only`/`--mode=extract-only`、`--mailbox`・年度範囲・名簿候補上限を含む運用フラグ）
- `apps/mail-worker/src/reextract.ts` — 一括再抽出 CLI（`--since` 必須）

## 既知のギャップ・未確認事項

- `apps/web/src/app/api/zip/route.ts` は郵便番号→住所検索（zipcloud プロキシ、会員登録フォーム向け）であり、mail-worker / 添付とは無関係。オーケストレーターの想定と異なるため本仕様には含めていない。
- `notify/line.ts`（システムアラート）と `line-broadcast.ts`（承認後の会員向け配信、notifications.md 管轄）は別チャンネル・別コードパス。両者とも `line_channels` テーブルを共有するが `status` カラムの値（`system` vs `assigned`/`active`）で区別される。
