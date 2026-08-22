# 大会・結果取込

> **責務:** 大会結果（Excel/HTML）の取込・承認・確定保存（materialize）、大会一覧/詳細の閲覧、大会系列（series/edition）の解決、参加名簿（申込/確定）の取込
> **関連画面:** `/tournaments`（大会結果・年別一覧）、`/tournaments/series`（大会別＝系列一覧）、`/tournaments/series/[id]`（系列詳細）、`/tournaments/[id]`（大会詳細＝入賞者＋級クロス表）、`/admin/mail-inbox/result-drafts/[id]`（結果ドラフトの承認/却下画面）
> **主要実装:**
> - `apps/web/src/app/(app)/tournaments/page.tsx`
> - `apps/web/src/app/(app)/tournaments/TournamentYearList.tsx`
> - `apps/web/src/app/(app)/tournaments/TournamentsHeader.tsx`
> - `apps/web/src/app/(app)/tournaments/[id]/page.tsx`
> - `apps/web/src/app/(app)/tournaments/[id]/TournamentDetailTabs.tsx`
> - `apps/web/src/app/(app)/tournaments/series/page.tsx`
> - `apps/web/src/app/(app)/tournaments/series/[id]/page.tsx`
> - `apps/web/src/app/(app)/admin/mail-inbox/result-drafts/[id]/page.tsx`（承認レビュー画面）
> - `apps/web/src/app/(app)/admin/mail-inbox/result-drafts/[id]/components/ApproveResultDraftForm.tsx`
> - `apps/web/src/app/(app)/admin/mail-inbox/result-drafts/[id]/components/RejectResultDraftButton.tsx`
> - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（`triggerResultParse` / `approveResultDraft` / `rejectResultDraft`）
> - `apps/web/src/lib/result-import/materialize.ts`（`materializeResultDraft`）
> - `apps/web/src/lib/edition/resolve.ts`（系列/開催の名寄せ・解決）
> - `apps/web/src/lib/roster-import/parser.ts`（申込/確定名簿パーサ）
> - `apps/web/src/lib/roster-import/materialize.ts`（申込/確定名簿の確定保存）
> - `apps/mail-worker/src/result-import/parser.ts`（Excel パーサ本体）
> - `apps/mail-worker/src/result-import/html-parser.ts`（HTML パーサ本体）
> - `apps/mail-worker/src/result-import/normalize.ts`
> - `apps/mail-worker/src/result-import/round-cell.ts`
> - `apps/mail-worker/src/result-import/reader.ts`
> - `apps/mail-worker/src/result-import/run.ts`
> - `apps/mail-worker/src/result-import/schema.ts`

## 機能仕様

### 概要

大会結果は「解析（draft）→ 管理者承認 → 確定保存（materialize）」の2段階で取り込む。ドラフト自体は改変不可能なデータではなく、承認前は再解析（再取込）で上書きできる。承認後は `tournaments` / `tournament_classes` / `tournament_participants` / `matches` へ実データとして書き込まれる（`result_drafts.status` は `pending_review` → `approved` / `rejected` / `parse_failed`）。承認済みの結果は、後続の訂正版ドラフトによる**明示的な差し替え**でだけ置き換わり、そのとき旧ドラフトは `superseded` へ遷移する（後述「差し替え承認」）。

取込元は2系統ある。

- **メール添付の Excel / PDF**: 管理者がメール詳細（`/admin/mail-inbox/mail/[id]`、mail-worker ドメイン管轄）で `.xls`/`.xlsx`/`.pdf` 添付を指定して「結果として取り込む」を実行すると `triggerResultParse` が `mail_worker_jobs`（`kind='result_parse'`）を積み、mail-worker の 30 秒タイマーが `runResultParse` を実行して解析する（受理拡張子の判定は `apps/web/src/lib/result-import/attachment.ts` の単一ソース）
- **かるた協会公式サイトの HTML**: `parseResultHtml` が同じ `ParsedClass[]` 契約に変換する。この関数はメール取込の承認フロー（`result_drafts`）には配線されていない。呼び出し元は本コードベース内の一括投入用ワンオフスクリプト（`scripts/diagnostics/_rehearse_load.mts`・`scripts/diagnostics/_probe.mts`）で、パース結果を `result_drafts` を経由せず `materializeResultDraft` へ直接渡し、過去大会データの一括投入に使われた

パーサは Excel/HTML どちらも同一の中間表現 `ParsedResultPayload`（`parserVersion` + `ParsedClass[]`）に正規化する（`apps/mail-worker/src/result-import/schema.ts`）。これにより承認画面・`materializeResultDraft` はソース形式を意識しない。

### Excel パーサ（`apps/mail-worker/src/result-import/parser.ts`）

様式の揺れが大きい大会結果 Excel を、ヘッダ行の「署名」検出で位置非依存に解析する。

- 先頭20行を走査し、選手名列（「選手名」「氏名」「名前」。ふりがな列は除外）・相手列（「相手」）・勝敗列（「勝敗」）が揃う行をヘッダ署名として検出する
- 相手列の並びから回戦ブロックを切り出し、各ブロック内で枚数列・勝敗列を探索する（見つからなければ「相手・枚数・勝敗」の慣例オフセットへフォールバック）。回戦ラベルは1行上のセルから「N回戦」等を拾う
- 見出し語ではなく「氏名列を持つ行」で参加者行と非参加者行（印刷ページの繰り返しヘッダ行、複数級を1シートに積む様式の級区切り行 `A2級` 等）を判別し、非参加者行はスキップする
- 段位（`normalizeDan`）・勝敗マーク（`parseResultChar`：○/〇/◯=win、×/✕/●/X/x=lose）・枚数差/不戦/棄権（`parseScoreCell`）を正規化する。回戦セル1個分の解析は `round-cell.ts` の `parseRoundCellText` に共通化されており、Excel の位置ベース列と HTML の1セルテキストの両方から呼ばれる

### AI ルーティング・級名正規化（`apps/mail-worker/src/result-import/ai/`）

決定的パーサは署名検出で高い成功率を出すが、非標準の様式ではシート名がそのまま級名になったり、複数級が1クラスに潰れたりする（パースが「成功」しても人が気づけない破綻）。これを検出するために、`result_parse` ジョブは**決定的パースを常に先に試行**し、その試行結果と生データを AI に突き合わせさせて**どのパース結果を採用するか**を判定させる。中身を見ずにパーサを選ばせるのではなく、無料・即時の試行結果を証拠にした判定である点が設計の要。

- **入力**: ファイル名・メール件名・シート名一覧・各シート先頭数行・決定的パースの試行結果要約（級名と人数）
- **出力**（`RoutingResultSchema`）:
  - `verdict` — `adopt`（決定的パースを採用）/ `escalate`（フル AI 抽出へ回す）/ `out_of_scope`（団体戦・名簿・抽選結果等）。`out_of_scope` でもドラフトは作り、承認画面に警告を出す（却下の最終判断は人）
  - `classMap` — className → 正規化級名 + `grade`(A–E|null) + `exclude`（非級シートの除外フラグ）。`applyClassMap` が payload に適用し、**原値は `ParsedClass.rawClassName` に保持**する（DB 列は追加していない。payload 内のみ）
  - `meta` — 大会名・回次・開催日・訂正版フラグ（`isCorrection`）。承認フォームのプリフィルに使う
  - `issues` — 整合検証で見つかった問題点
- **fail-open**: AI 呼び出しが失敗しても取込は止めない。決定的パース結果だけで `pending_review` を作り、失敗理由を `result_drafts.ai_error` に記録して承認画面に「AI 検証なし」と表示する。`ANTHROPIC_API_KEY` が未設定の環境でも同じく決定的パースのみで動く（ワーカー起動時に警告ログを出して AI を無効化する）。**唯一の例外はフル抽出出力の Zod 検証失敗**で、これだけは `parse_failed` にする（検証を通っていないデータを承認可能にしないため）
- **コスト記録**: モデル・プロンプト版・トークン・USD を `result_drafts` の `ai_model` / `ai_prompt_version` / `ai_tokens_input` / `ai_tokens_output` / `ai_cost_usd`（ルーティング + フル抽出の合算）へ保存する

### フル AI 抽出フォールバック

次のいずれかで発動し、上位モデルに全シートの CSV 化テキスト（PDF はネイティブ document block）を渡して `ParsedResultPayload` 互換の構造化データを生成する。

- 決定的パースが 0 クラス
- ルーティングの `verdict` が `escalate`（整合検証で破綻判定）
- 添付が PDF（ルーティングを経ずに直行。`readExcel` は PDF を読めないため分岐は Excel 読込より前）

出力は `ParsedResultPayloadSchema` で検証し、不整合なら `parse_failed`（不正データが承認可能にならない）。由来は `result_drafts.extraction_source='ai'` と `parserVersion='ai-extract-<PROMPT_VERSION>'` に記録し、承認画面に「AI 抽出（要注意レビュー）」を表示する。PDF は既存の `MAIL_WORKER_PDF_SIZE_LIMIT_KB` ガードを流用する。

### HTML パーサ（`apps/mail-worker/src/result-import/html-parser.ts`）

全日本かるた協会が公開する結果ページ（`table.tournament_tree`）を同じ `ParsedClass[]` へ変換する。見出し `<h2>` から大会名、その直後のテキストから開催日（`YYYY年MM月DD日` → `YYYY-MM-DD`）を抽出する。不戦（bye）セルは実データ上マークアップが崩れる（`result_cell` が閉じた直後に無クラスの `<td>` が続く）ため、`td.result_cell` だけでなく全 `<td>` を走査して回戦の列位置を保つ。選手名・相手名は正規化のみ（`normalizeText`）で保存し、同定・突合は materialize 側の責務。

### 承認と確定保存（materialize）

`materializeResultDraft`（`apps/web/src/lib/result-import/materialize.ts`）が呼び出し元トランザクション内で実行する。

**識別（identity）の粒度**: 1回の承認＝1件の「開催（大会）× 級」を単位に確定保存される（`tournaments` 行1件 → 配下に級ごとの `tournament_classes`）。ただし `tournaments` 側に既存大会との重複排除（同名・同日での dedup）は無く、承認するたびに必ず新規 `tournaments` 行が作られる。既存大会シリーズとの結び付けは、承認画面で明示選択した edition を優先し、未選択時だけ後述の自動解決を試みる。結果承認後の級は、同じ級のクラスが1件だけで既存の採用リンクがない場合に限り、年度回数計算用の実出場原本へ自動リンクする。既存リンクの上書きは承認に含めず、専用の明示置換操作で旧リンクを版として残す。選手の同定キーは正規化姓名のみ（所属会は使わない。詳細は [spec/players.md](players.md)）。

1. 大会名から開催（edition）を best-effort で自動解決する（`autoResolveEdition`、後述）。解決できれば `tournaments.editionId` に張る
2. `tournaments` 行を1件作成（`sourceResultDraftId` で承認元ドラフトを追跡）
3. 級（`ParsedClass`）ごとに `tournament_classes` を作成し、その級の対戦から順位 bracket（優勝=1/準優勝=2/ベスト4=4…）を参加者 index 単位で事前算出して `tournament_participants.derivedBracket` に保存する（導出できない級＝リーグ戦・順位戦混在等は `null` のまま。導出アルゴリズム自体（`apps/web/src/lib/players/placement.ts` の単一ソース）は [spec/players.md](players.md)、統計での集計利用は [spec/stats.md](stats.md) が正典）
4. 参加者ごとに選手（`players`）を get-or-create する。同定キーは**正規化姓名のみ**（所属会は使わない）。所属・段位・ふりがな等の生値は `tournament_participants` にスナップショットとして保持し、`players` 行には持たせない。触れた選手は、正規化した `users.name` が1会員だけに一致するとき `players.userId` も同期する（同定規則の詳細は [spec/players.md](players.md)）
5. 対戦（`matches`）を2パス目で挿入する。自分の参加者IDは配列 index で一意に特定し、相手は正規化名がその級内で**単独一致**したときだけ `opponentParticipantId` を解決する（同姓同名が複数いる/不明な場合は `null` のまま `opponentName` の文字列だけを保持）
6. この大会で触れた選手全員の `display_name` を再計算する（`recomputePlayerDisplayNames`。最頻表記への収束。詳細は [spec/players.md](players.md)）

承認・却下は `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` の `approveResultDraft` / `rejectResultDraft`（画面は `/admin/mail-inbox/result-drafts/[id]`）。承認対象editionとドラフト行をトランザクション内でロックして状態を再確認し、`materializeResultDraft` と実出場原本の初回リンクを同一トランザクションで実行することで、二重承認による重複materializeを防ぐ。承認済みの `mail_messages` は `triage_status='processed'` に同期される。却下は `pending_review` / `parse_failed` のみ可能で理由必須。既存の実出場原本を別の承認済み結果へ差し替える場合は `replaceActualResultFact` を使い、画面に表示したactive fact IDを再検証してから旧factの `valid_to` を閉じ、新revisionを挿入する。

`result_parse` ジョブハンドラ（`apps/mail-worker/src/result-import/run.ts` の `runResultParse`）は解析結果を `result_drafts` に UPSERT する。既存ドラフトが `approved`/`pending_review` なら上書きせず、`parse_failed`/`rejected`/`superseded` のときだけ再取込で置き換える（`triggerResultParse` の状態ガードと同じ方針をワーカー側でも二重に持つ）。解析失敗時は `status='parse_failed'` として `parseError` を保存し、承認は不可・却下のみ可能な画面になる。

### edition×級 突合・部分承認・差し替え

同一大会の結果は級別分割・再送・訂正版という形で**複数のメールに分かれて届くのが日常**であり、承認するたび新規 `tournaments` 行を作る素朴な運用では二重登録が起きる。これを承認画面の粒度で防ぐのが突合・部分承認・差し替えの3点セット。

**突合**: 承認画面で管理者が開催回を選択している場合、payload の各級の `grade` を同 edition 配下の既存 `tournament_classes` と突き合わせる（`getEditionImportedGrades`。`result-drafts/[id]/actions.ts` の read-only Server Action）。既取込の級は「取込済み」バッジ付き・**既定チェック OFF**、未取込の級は既定 ON。edition 未確定なら突合バッジを出さず全級既定 ON（従来挙動）。

**部分承認**: チェックした級だけを materialize する（`tournaments` 行は選択級のみで作成）。全級選択時の結果は従来の承認と同一。0級選択での承認はエラー。選択は承認フォームの `selectedClasses`（payload.classes の index 配列 JSON）で送る。未指定は全級選択とみなす（既存の呼び出しとの後方互換）。

**差し替え承認**: 既取込の級は明示操作（`replaceGrades`。grade 配列 JSON）でのみ承認対象にできる。**開催回の明示選択が必須**（未選択だと「どの旧データを差し替えるのか」が決まらないため、大会名の自動解決には委ねずエラーにする）。1トランザクションで次を実行する。

1. ドラフト行と edition をロックし、差し替え対象 grade の**旧クラス群**と、その配下の**旧側 player id 集合**を先に収集する
2. 選択級だけで materialize（新 `tournaments` 行）
3. 差し替え級の active fact（`valid_to IS NULL`）が旧クラスを指していれば `linkActualResultClass(replaceExisting: true)` で**新クラスへ revision 付きで再リンク**する（当落線・出場回数の集計が新データで継続する）。差し替え級の新クラスが級内で一意に定まらない場合は承認を拒否する
4. 旧クラス群を**物理削除**する（`tournament_participants` / `matches` は FK cascade）。クラスが 0 件になった旧 `tournaments` 行も削除する
5. 監査記録: クラスが全滅した旧 `tournaments` を生んだドラフトは `status='superseded'` + `superseded_by_draft_id`。一部だけ差し替えた旧 `tournaments` は `note` へ差し替え記録を追記する
6. **旧側の選手**について `syncPlayersToUniqueMembers` + `recomputePlayerDisplayNames` を再実行する（削除で消えた出場を反映して表示名・会員リンクを引き直す）。新側の選手は `materializeResultDraft` が内部で済ませており、新旧どちらにも出る選手は旧側集合に含まれるのでここで最新化される

**なぜ論理削除ではなく物理削除か**: materialize 済みの4表は `result_drafts.extracted_payload` とメール添付から常に再導出できる「導出層」である。supersede 列による論理削除は統計・戦績・当落線の読み取り約35箇所へ除外フィルタを恒久的に課し、1箇所の漏れが当落線の静かな二重計上になる。物理削除なら読み取り側は無変更で済む。復旧は該当メールから再取込 → 再承認（`superseded` は再取込可能ステータス）。

> **運用制約**: この復旧はメール添付が残っていることが前提。添付のプルーニングを導入する場合は `approved` / `superseded` ドラフトが参照する添付を除外すること（[spec/mail-worker.md](mail-worker.md) に同旨を記載）。

### 大会系列（series）・開催（edition）の解決

大会名の文字列（例:「第27回こばえちゃ山形酒田大会C級」）から `tournament_series`（系列マスタ）・`tournament_series_editions`（開催＝回次マスタ）を解決するロジックが `apps/web/src/lib/edition/resolve.ts` に集約されている。結果取込・大会案内承認の双方から利用される共通コアで、**名寄せは100%自動にしない**方針を貫く。

- `parseAnnouncementName` が大会名から「第N回」の回次と、回次・末尾の級サフィックス（「A級」「A・B級」「(A〜C級)」等）を除いた系列名候補を抽出する
- `normalizeForMatch`（NFKC・空白/区切り記号除去）で正規化した文字列同士を比較し、`scoreSeries` が完全一致=100・部分包含=50でスコア付けする
- `autoResolveEdition`（結果取込 flow②で使用）は「系列が正規化完全一致かつ単独最良」かつ「回次が取れた」ときだけ `findOrCreateEdition` を呼んで自動 link する。曖昧・新規系列・回次不明のときは link せず候補一覧を返すのみ（誤った大会への紐付けを避ける）。新規系列は自動作成しない
- `findOrCreateEdition` は親 `tournament_series` 行を `FOR UPDATE` でロックしてから `UNIQUE(series_id, edition_number)` で解決/新規作成する。既存 edition が `unconfirmed`（大会案内承認時点で作成）で今回 `held`（結果取込）が解決された場合はライフサイクルを `held` に確定し、`year`/`rawName` が未設定なら補完する（既存値は上書きしない）
- `findOrCreateSeries` は完全一致が単独のときだけ既存系列を返し、複数一致は曖昧としてエラー、未一致は `allowCreate` が明示されたときのみ新規作成する（silent な新規マスタ化を防ぐ）。系列の `kind`（individual/team）と紐付け要求の不一致もエラーにする

このコアは大会案内承認（`tournament_drafts` → `events` 作成。`apps/web/src/app/(app)/admin/mail-inbox/actions.ts` の `approveDraftUnits` 等）からも呼ばれるが、`events`・大会申込の画面/フローそのものは [spec/events-attendance.md](events-attendance.md) が正典。ここでは edition/series 解決ロジックのみを正典として扱う。

### 参加名簿（申込/確定）の取込

`apps/web/src/lib/roster-import/parser.ts`（`parseRosterGrid`）が名簿 Excel の氏名表を持つ全シートをヘッダ語検出で解析する。氏名/姓+名・ふりがな・A〜E級・所属・段位・出場状態・当落区分・抽選除外列を任意組み合わせで許容し、行に級がなければ明示的なシート名から補う。自己申告の出場回数列は集計入力に使わない。同一級で正規化氏名が重複した場合は自動除外せず検証エラーにする。`materialize.ts`（`materializeRoster`）が `tournament_entry_rosters` / `tournament_entry_roster_entries` へ確定保存する。

- **entry-groups: 名簿の帰属は event ではなく申込グループ**（`tournament_entry_rosters.entry_group_id`）。
  名簿・抽選結果メールが「同じ案内メール × 同じ申込締切」のクラスタ単位で届く実態に合わせたもので、
  グループ内のどの日の大会詳細からも**同一の名簿**が見える。版管理の一意性も
  `(entry_group_id, roster_type, version)` へ読み替えている。FK は **ON DELETE RESTRICT**
  （events からの旧 FK は cascade だった）— 空グループの削除が名簿を道連れにしないための
  DB 側バックストップで、削除は `deleteGroupIfEmpty` が rosters 0件を確認してから行う。
- **再取込は版管理**: entry_groups行をロックして同一 `(entry_group_id, roster_type)` のversionを採番する。訂正は明示した有効版だけをsupersededにし、旧名簿とentriesを削除しない。後日の追加発表は旧版をsupersedeせず併存できる。大会詳細はsupersededを除外し、種別ごとの最大versionだけを表示する
- 確定名簿発表は `publishConfirmedRoster` で既存rosterへ明示的に関連付ける。無抽選で申込名簿を確定名簿として兼用する場合もrosterを複製せず参照でき、後日の別発表も併存できる
- 各行の選手も `result-import` と同型の get-or-create（正規化姓名キーのみ、`onConflictDoNothing`）で `players` に解決する
- 会員突合: 正規化姓名が会員（`users.name`）に**単独一致**したときだけ `entry.userId` と `players.userId` を張る。0件または複数一致では両方を `null` にし、既存の曖昧な自動リンクも解除する
- 出場状態（`roster_entry_status`）はファイルの状態列テキストから `mapEntryStatus` でマップする。繰上（繰上/繰り上）表記をまず判定し、その中で辞退/不参加を伴うものだけを `carried_up` より先に `carry_up_declined` とする順序が重要（そうしないと「繰り上げ辞退」が出場扱いに倒れる）。名簿は外部事実として扱い、取込では出欠を自動更新しない

取込の入口は**メール取り込みの承認 UI（`/admin/mail-inbox/roster-drafts/[id]`）のみ**で、**2026-08-01 にメール詳細からの導線を退役させた**ため新規のドラフトは UI からは作られない（パーサ・Server Action・承認画面・テーブルは温存。直 URL では従来どおり動き、将来の AI 名簿取込が承認 UI と materialize を再利用する）。以下は温存されたパース経路の仕様。entry-groups 以降は採用先も申込グループで、承認時にグループ内の全日の詳細ページを revalidate する。大会詳細（`/events/[id]`）にあった Excel アップロードフォームと Server Action `uploadRoster` は event-detail-redesign で削除した — メール側が発行日の入力・訂正版の指定も含めて上位互換で、`applicant` / `confirmed` の両方を取り込めるため。削除に伴い `uploadRoster` が持っていた `kind !== 'individual'`（団体戦）ガードも失われるが、団体戦に名簿を取り込む運用が無いため許容している。`parseRosterGrid` / `materializeRoster` / `readExcel` はメール取込フローが使う共有ライブラリなので削除していない。大会詳細側の名簿**表示** UI（級タブ・級の若い順・会員突合）の詳細は [spec/events-attendance.md](events-attendance.md) を参照。ここでは解析・確定保存ロジックのみを正典として扱う。

### 名簿ファイルの採用（パース非依存の原本登録）

様式が主催者ごとに多様でルールベースの解析が原理的に追随できないため、**パースせず原本ファイルのまま**名簿として登録する経路を併走させる（`tournament_entry_roster_files`）。構造化データを持たないので統計・当落線・出場回数には一切寄与せず、担うのは「会の進行を止めない」ことだけ。AI 名簿取込を導入した後も、抽出に失敗する原本の受け皿として残す。

- 採用できるのは admin / vice_admin。採用元は**メール添付のみ**（手動アップロードは持たない。メール以外で入手した名簿は自分宛に転送する運用）。添付は拡張子で絞らない（パースしないので `.jpg` や `.zip` を弾く理由がない）。
- 採用時に指定するのは**対象の申込グループ**（`entry_group`）・**取込単位**・**種別**（applicant / confirmed）・**発表日**（任意。既定はメール受信日 JST）だけ。edition 紐付け・級別設定・抽選事実（lottery facts）は一切要求しない —— これが承認フロー（`tournament_roster_import_drafts`）との本質的な違い。
- **取込単位**は「グループ統一名簿」（グループの全級をカバーする 1 ファイル。`grades` は NULL）か「級別名簿」（`grades` に級を持つ。`A・B級名簿` のように複数級を 1 ファイルでカバーする場合は同一グループ内で複数級を指定する）。名簿は基本「同グループの全級が 1 Excel」で届くが、級ごとに別ファイルで来る主催者もあるため両方の単位で登録できる。級の列挙元はグループ内個人戦イベント（cancelled 除外）の `eligible_grades` の和集合で、級情報が無いグループはグループ統一でのみ採用できる。
- `adoptRosterFile(attachmentId, entryGroupId, rosterType, grades, publishedAt?)` が強制するのは**基本条件のみ**: グループ内に「個人戦 ∧ cancelled でない ∧ 開催日が `linkable-events.ts` の cutoff（過去 30 日）以降」を**同一の event 行が同時に満たす**日が 1 つ以上あること（3 条件を別々の存在判定に分けると「団体戦だけが cutoff 内で個人戦は 30 日より古い」グループが通る穴になる）。名簿は個人戦専用の仕様で、団体戦を通すと採用は成功するのに `RosterSection` にも申込管理ボードにも現れない行き止まりになる。級別採用では指定級がグループの級集合（cutoff は掛けない独立条件）に含まれることも検証し、`grades` は空配列を明示エラーにしたうえで dedupe + A→E 昇順に正規化して保存する。UI の候補フィルタ（申込済み・未取込）は**サーバーでは強制しない** —— 「すべて表示」トグル経由の採用が正規の逃げ道であるため。対象グループの直指定になったことで空グループ削除（`deleteGroupIfEmpty`）との競合が INSERT の FK 違反として表面化しうるので、`isForeignKeyViolation`（23503）を `isUniqueViolation` と並べて日本語メッセージへ変換する。
- 同一 entry_group × 種別へ**複数ファイル**を採用できる（「参加者一覧」と「参加費一覧」など）。**同一添付の二重採用は不可**（DB の UNIQUE。付け替えは解除→再採用）。
- 解除するとボード分類・大会詳細表示が採用前へ戻る。メール添付そのものは消えない。
- 既存の名簿ドラフト（`pending_review` / `rejected`）とは**独立**。ドラフトの状態を読まず・変えず、ドラフトの有無が採用を妨げることもない。
- 空グループ削除（`deleteGroupIfEmpty`）は採用ファイルを持つグループを削除しない（`entry_group_id` は RESTRICT）。

閲覧は**ログイン済みの全会員**に開く（パース済み名簿が既に氏名・所属を全会員へ表示しているのと同等の扱い）。会員向け経路は `/roster-files/[id]`（ビューア）・`/api/roster-files/[id]`（バイナリ）・`/api/roster-files/[id]/preview/[page]`（ページ JPEG）の3本で、認可は `lib/roster-file-access.ts` の `loadAdoptedRosterFile` に一本化した「採用済みかどうか」だけ（fail-closed。解除・添付削除のいずれでも 3 経路とも 404）。表示は管理者向けビューアと同じ `attachment-preview.ts` のページ画像化を流用し、MIME allowlist / `Content-Disposition` の規約も管理者向け route と同一に保つ（iOS PWA の白画面死対策。判定一致はテストで固定）。`detectPreviewKind` が `none` を返す型はページ画像を出さずダウンロードのみを提供する。管理者向け `/admin/mail-inbox/attachments/[id]` 系は従来どおり別経路のまま変更していない。ページ画像 route は、変換済みページ数がキャッシュに載っている添付への**範囲外ページ要求を変換の起動前に 404 で弾く**（`renderAttachmentPreview` は `force: true` でメタキャッシュを迂回するため、範囲判定を変換後に置くと存在しないページの連打で変換を無制限に再実行できる。この route は会員全員に開いており管理者向けより露出が広い）。

## 画面

### `/tournaments`（大会結果・年別一覧）

全大会を開催日降順・年セクションで一覧表示する。行に級構成トーンドット（`GradeDots`）と参加者数を出し、行タップで大会詳細へ遷移する。中止回は「中止」表示・参加者数は「—」。`short_name`（通称）が edition 経由で解決していれば「通称＋開催級（A→E順連結）」を行タイトルに合成し、無ければ大会の正式名称にフォールバックする（この合成は年別一覧に閉じており、大会詳細・シリーズ詳細・選手詳細は常に正式名称）。「もっと見る」は Server Action `loadMoreTournaments`（`apps/web/src/app/(app)/tournaments/actions.ts`）でオフセット追記する。

大会別（`/tournaments/series`）とはヘッダ（`TournamentsHeader`）のトグルで切り替え、大会名検索（`?q=`）は両ビュー共通。表示に使う集計クエリ（`getTournamentList` / `getSeriesList` 等）は `lib/stats/` 配下（stats ドメイン管轄）。

### `/tournaments/series`・`/tournaments/series/[id]`（大会別＝系列一覧・詳細）

系列を1行に束ねて累計開催回数・回次範囲・直近年・状態内訳（開催/中止/未確定）を表示する一覧と、系列詳細（回次一覧＋参加者数推移チャート）。回次一覧は結果データのある回（`tournamentId` あり）のみ大会詳細へタップ可能で、中止・記録なしの回は非タップ表示にする。

entry-groups で名簿がグループ帰属になったため、edition 基準の整合性チェック
（`appearance-counts.ts` / `series-metrics.ts` / mail-worker の `coverage-report.ts`）は
`roster.event_id = events.id` の JOIN から
`EXISTS (SELECT 1 FROM events e WHERE e.entry_group_id = roster.entry_group_id AND e.edition_id = publication.edition_id)`
へ書き換えた。**`edition_id` を roster 側へ非正規化してはならない** — 承認フローが後から
edition を紐付けるため、コピーすると stale になる。集計結果そのものは不変（回帰テストで担保）。

系列詳細の「申込・抽選の推移」は A〜E 級のタブを持ち、級ごとに申込者数の推移と、抽選時は倍率（小数第2位）・分子/分母、定員未満時は残り枠・定員充足率、定員設定なし時は専用状態を表示する。原本不足などで集計が不完全な回は理由だけを示し、取得済みの部分値を一般画面へ出さない。A級は主催者枠と年度開始時点の出場回数層を積み上げ、完全な履歴がある場合だけ定員線と当落境界を表示する。公開レスポンスと画面には氏名、会員・選手・名簿の内部ID、原本情報を含めない。長い系列は横軸ラベルを間引き、375px幅とダークモードでも既存の級別詳細・回次リンクを損なわない。

### `/tournaments/[id]`（大会詳細）

大会の入賞者タブ（全級ブロック横断の1〜4位）と級タブ（選手×回戦のクロス表、勝ち上がり順・敗退後は空欄）を切り替えるプッシュ画面。`?from=` で戻り先（一覧/シリーズ詳細どちらから来たか）を保持する（内部パスのみ許可。オープンリダイレクト防止）。クロス表の行タップは戦績詳細（players ドメイン）へ遷移する。表示データの集計・型（`ClassBlock` / `CrosstabCell` 等）は `lib/stats/results.ts`（stats ドメイン管轄）。

### `/admin/mail-inbox/result-drafts/[id]`（結果ドラフト承認）

ルートは mail-inbox（メール受信箱）配下だが、結果取込の承認・却下という本ドメインの中核操作を行う画面のため本書が正典として扱う。ドラフトの状態（承認待ち/承認済み/却下/取込失敗/差替済み）に応じた表示切り替え、解析結果プレビュー（級ごとの参加者数・試合数、参加者上位10名の順位/氏名/所属/勝敗数）、承認フォーム（大会名必須・開催日/会場任意）、却下ボタン（理由必須のテキストエリア）を持つ。`parse_failed` は却下のみ可能（承認不可）。

AI 所見の表示（`result_drafts` の AI 列由来）: `verdict='out_of_scope'` なら対象外の警告、`meta.isCorrection` なら差し替え操作を促す表示、`extraction_source='ai'` なら「AI 抽出」の由来、`ai_error` が非 null なら「AI 検証なし」。大会名・開催日は AI が抽出したメタでプリフィルする。級ごとのチェックボックス（部分承認）と「取込済み」バッジ・差し替えチェックは前述「edition×級 突合・部分承認・差し替え」を参照。

## フロー

### 結果取込フロー（メール添付Excel）

1. 管理者がメール詳細で添付（Excel または PDF）を指定し「結果として取り込む」→ `triggerResultParse` が `mail_worker_jobs`（`kind='result_parse'`）を作成（既存ドラフトが `pending_review`/`approved` ならエラーで弾く）。**取込の起点は手動トリガーのみ**（受信時の自動検知はしない）
2. mail-worker のタイマーが `runResultParse` を実行:
   - PDF → フル AI 抽出へ直行
   - Excel → `readExcel` → `parseResultExcel`（決定的パース。常に先に試行）→ AI ルーティングで採用可否を判定 → `adopt` なら級名正規化マップを適用、`escalate` / 0クラスならフル AI 抽出へ
   - 結果を `result_drafts` へ UPSERT（`pending_review` または `parse_failed`）し、AI 所見・トークン・コストを同じ行に記録する。AI 呼び出しが失敗しても決定的パース結果で `pending_review` を作る（fail-open）。Web Push で管理者へ完了通知（best-effort）
3. 管理者が `/admin/mail-inbox/result-drafts/[id]` でプレビューと AI 所見を確認し、大会名・開催日・会場（AI 抽出値でプリフィル）と**取り込む級**を選んで承認、または理由を入力して却下
4. 承認時は `approveResultDraft` → `materializeResultDraft` が同一トランザクションで実行され、**選択した級だけ**が `tournaments`/`tournament_classes`/`tournament_participants`/`matches` へ確定保存される。既取込級の差し替えを指定していれば旧級の削除と実出場原本の再リンクも同じトランザクションで行う。以後この大会結果は `/tournaments/[id]` 等の閲覧画面（stats ドメイン集計経由）に反映される

### 名簿取込フロー

管理者がメール詳細から対応する添付または本文を原本単位で解析し、`tournament_roster_import_drafts` に確認用ドラフトを生成する。レビュー画面では開催回・対象イベント・原本用途（申込／抽選結果／後日確定）・初回／訂正／追加発表・発表日と級別factを明示し、全級をまとめて採用する。行の級が一部だけ欠けた複数級ドラフトは先頭級へ寄せず採用を拒否する。採用時は設定した級をイベントの `eligible_grades` へ反映し、開催回の大会区分と根拠メモを同じ管理者・原本メールで監査記録する。A級抽選は抽出行の主催者枠・抽選除外表示を確認し、「該当なし」を含め分類確認を明示しなければ採用できない。この承認をfactの `verified_at` / `verified_by_user_id` に記録し、全falseが未確認なのか確認済み0人なのかを区別する運用契約とする。訂正は指定したactive rosterだけをsupersedeし、後日追加発表は旧版と併存する。申込名簿を確定名簿として兼用する場合も級ごとに明示する。同一級の氏名重複などの検証エラーは抽出行とともにレビュー画面へ残るが、解消前の採用はできない。既存の大会詳細から行う直接取込は後方互換として維持する。

過去名簿のmailbox×年度dry-run、IMAP UID再開カーソル、2024年以降の大会区分／対象級／級別確定名簿／級別実出場原本coverageは [data-quality/tournament-lottery-backfill.md](../data-quality/tournament-lottery-backfill.md) の手順で確認する。coverage不足は0件で補完せず、該当する年度回数・倍率・当落線をincompleteのまま維持する。本番migration、非dry-run取得、ドラフト一括生成、採用は各段階で明示承認を得る。

## API（Server Actions / ジョブハンドラ）

- `triggerResultParse(mailId, attachmentId)` — `.xls`/`.xlsx`/`.pdf` 添付を指定して `result_parse` ジョブを積む。受理拡張子の判定は `isResultImportAttachment`（`apps/web/src/lib/result-import/attachment.ts`。承認画面・メール詳細と共有する単一ソース）。既存ドラフトの状態ガードあり（`apps/web/src/app/(app)/admin/mail-inbox/actions.ts`）
- `approveResultDraft(draftId, formData)` — 大会名/開催日/会場に加えて `selectedClasses`（取り込む級の index 配列 JSON。未指定＝全級）と `replaceGrades`（差し替える grade の配列 JSON）を受け取り、選択級だけで `materializeResultDraft` を実行して `result_drafts.status='approved'` に遷移。差し替え指定があれば旧級の物理削除・実出場原本の再リンク・監査記録まで同一トランザクションで行う。`FOR UPDATE` で二重承認をガード
- `getEditionImportedGrades(editionId)` — 開催回配下で既に取込済みの級を返す read-only Server Action（`result-drafts/[id]/actions.ts`）。承認画面の突合バッジ・既定チェック状態の入力
- `replaceActualResultFact(draftId, classId, expectedFactId)` — 承認済み結果の単独級クラスを実出場原本へ明示的に差し替える。画面表示時のactive fact IDが変わっていれば拒否し、旧factを削除せずrevision化する
- `rejectResultDraft(draftId, reason)` — `pending_review`/`parse_failed` のドラフトを理由付きで却下
- `triggerRosterParse(mailId, attachmentId)` / `approveRosterImportDraft(draftId, formData)` / `rejectRosterImportDraft(draftId, reason)` — メール原本の解析enqueue、レビュー済み名簿の版管理採用、却下。採用時はedition/event/全級設定を再検証し、roster/publication/級別factを同一トランザクションで更新する
- `runResultParse(opts)`（`apps/mail-worker/src/result-import/run.ts`）— ジョブ本体。Excel 読込・決定的パース・AI ルーティング（fail-open）・必要ならフル AI 抽出・`result_drafts` UPSERT・`mail_worker_runs` 記録・Web Push 通知
- `AnthropicResultImportAi` / `FixtureResultImportAi` / `applyClassMap`（`apps/mail-worker/src/result-import/ai/`）— provider 中立の AI クライアントと級名正規化マップの適用（純関数）。テストは fixture 実装を注入する
- `materializeResultDraft(tx, payload, opts)`（`apps/web/src/lib/result-import/materialize.ts`）— 解析済みペイロードから確定テーブル群への書き込み本体。呼び出し元トランザクション内で実行する前提（単体では commit しない）
- `autoResolveEdition` / `findOrCreateEdition` / `findOrCreateSeries` / `suggestEditionFromName`（`apps/web/src/lib/edition/resolve.ts`）— 系列・開催の解決 API 群。結果取込・大会案内承認の双方から呼ばれる共通コア
- `loadMoreTournaments(query, offset)`（`apps/web/src/app/(app)/tournaments/actions.ts`）— 年別一覧の追加読み込み（audience=全ログインユーザー、認証必須）
- 名簿取込 Server Action（`parseRosterGrid` → `materializeRoster` を呼ぶ）は `apps/web/src/app/(app)/events/[id]/actions.ts` にある（画面・呼び出し導線は events ドメイン管轄）
