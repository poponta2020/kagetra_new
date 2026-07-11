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

大会結果は「解析（draft）→ 管理者承認 → 確定保存（materialize）」の2段階で取り込む。ドラフト自体は改変不可能なデータではなく、承認前は再解析（再取込）で上書きできる。承認は不可逆で、承認後は `tournaments` / `tournament_classes` / `tournament_participants` / `matches` へ実データとして書き込まれる（`result_drafts.status` は `pending_review` → `approved` / `rejected` / `parse_failed`。`superseded` はスキーマ上定義済みだが現行の取込フローには遷移させるコードパスがなく、将来の訂正版再取込向けの予約値）。

取込元は2系統ある。

- **メール添付の Excel**: 管理者がメール詳細（`/admin/mail-inbox/mail/[id]`、mail-worker ドメイン管轄）で `.xls`/`.xlsx` 添付を指定して「結果として取り込む」を実行すると `triggerResultParse` が `mail_worker_jobs`（`kind='result_parse'`）を積み、mail-worker の 30 秒タイマーが `runResultParse` を実行して解析する
- **かるた協会公式サイトの HTML**: `parseResultHtml` が同じ `ParsedClass[]` 契約に変換する。この関数はメール取込の承認フロー（`result_drafts`）には配線されていない。呼び出し元は本コードベース内の一括投入用ワンオフスクリプト（`scripts/diagnostics/_rehearse_load.mts`・`scripts/diagnostics/_probe.mts`）で、パース結果を `result_drafts` を経由せず `materializeResultDraft` へ直接渡し、過去大会データの一括投入に使われた

パーサは Excel/HTML どちらも同一の中間表現 `ParsedResultPayload`（`parserVersion` + `ParsedClass[]`）に正規化する（`apps/mail-worker/src/result-import/schema.ts`）。これにより承認画面・`materializeResultDraft` はソース形式を意識しない。

### Excel パーサ（`apps/mail-worker/src/result-import/parser.ts`）

様式の揺れが大きい大会結果 Excel を、ヘッダ行の「署名」検出で位置非依存に解析する。

- 先頭20行を走査し、選手名列（「選手名」「氏名」「名前」。ふりがな列は除外）・相手列（「相手」）・勝敗列（「勝敗」）が揃う行をヘッダ署名として検出する
- 相手列の並びから回戦ブロックを切り出し、各ブロック内で枚数列・勝敗列を探索する（見つからなければ「相手・枚数・勝敗」の慣例オフセットへフォールバック）。回戦ラベルは1行上のセルから「N回戦」等を拾う
- 見出し語ではなく「氏名列を持つ行」で参加者行と非参加者行（印刷ページの繰り返しヘッダ行、複数級を1シートに積む様式の級区切り行 `A2級` 等）を判別し、非参加者行はスキップする
- 段位（`normalizeDan`）・勝敗マーク（`parseResultChar`：○/〇/◯=win、×/✕/●/X/x=lose）・枚数差/不戦/棄権（`parseScoreCell`）を正規化する。回戦セル1個分の解析は `round-cell.ts` の `parseRoundCellText` に共通化されており、Excel の位置ベース列と HTML の1セルテキストの両方から呼ばれる

### HTML パーサ（`apps/mail-worker/src/result-import/html-parser.ts`）

全日本かるた協会が公開する結果ページ（`table.tournament_tree`）を同じ `ParsedClass[]` へ変換する。見出し `<h2>` から大会名、その直後のテキストから開催日（`YYYY年MM月DD日` → `YYYY-MM-DD`）を抽出する。不戦（bye）セルは実データ上マークアップが崩れる（`result_cell` が閉じた直後に無クラスの `<td>` が続く）ため、`td.result_cell` だけでなく全 `<td>` を走査して回戦の列位置を保つ。選手名・相手名は正規化のみ（`normalizeText`）で保存し、同定・突合は materialize 側の責務。

### 承認と確定保存（materialize）

`materializeResultDraft`（`apps/web/src/lib/result-import/materialize.ts`）が呼び出し元トランザクション内で実行する。

**識別（identity）の粒度**: 1回の承認＝1件の「開催（大会）× 級」を単位に確定保存される（`tournaments` 行1件 → 配下に級ごとの `tournament_classes`）。ただし `tournaments` 側に既存大会との重複排除（同名・同日での dedup）は無く、承認するたびに必ず新規 `tournaments` 行が作られる。既存大会シリーズとの結び付けは後述の edition 解決が best-effort で行うのみで、「同じ大会の結果を2回承認すると別大会として重複登録される」という前提を UI 運用（1ドラフト=1度だけ承認）で担保している。訂正版の再取込・差し替え（`result_drafts.status='superseded'`）はスキーマに列（`superseded_by_draft_id`）と enum 値が予約されているが、現行コードにこれを遷移させる経路はない（将来拡張）。選手の同定キーは正規化姓名のみ（所属会は使わない。詳細は [spec/players.md](players.md)）。

1. 大会名から開催（edition）を best-effort で自動解決する（`autoResolveEdition`、後述）。解決できれば `tournaments.editionId` に張る
2. `tournaments` 行を1件作成（`sourceResultDraftId` で承認元ドラフトを追跡）
3. 級（`ParsedClass`）ごとに `tournament_classes` を作成し、その級の対戦から順位 bracket（優勝=1/準優勝=2/ベスト4=4…）を参加者 index 単位で事前算出して `tournament_participants.derivedBracket` に保存する（導出できない級＝リーグ戦・順位戦混在等は `null` のまま。導出アルゴリズム自体（`apps/web/src/lib/players/placement.ts` の単一ソース）は [spec/players.md](players.md)、統計での集計利用は [spec/stats.md](stats.md) が正典）
4. 参加者ごとに選手（`players`）を get-or-create する。同定キーは**正規化姓名のみ**（所属会は使わない）。所属・段位・ふりがな等の生値は `tournament_participants` にスナップショットとして保持し、`players` 行には持たせない（同定規則の詳細は [spec/players.md](players.md)）
5. 対戦（`matches`）を2パス目で挿入する。自分の参加者IDは配列 index で一意に特定し、相手は正規化名がその級内で**単独一致**したときだけ `opponentParticipantId` を解決する（同姓同名が複数いる/不明な場合は `null` のまま `opponentName` の文字列だけを保持）
6. この大会で触れた選手全員の `display_name` を再計算する（`recomputePlayerDisplayNames`。最頻表記への収束。詳細は [spec/players.md](players.md)）

承認・却下は `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` の `approveResultDraft` / `rejectResultDraft`（画面は `/admin/mail-inbox/result-drafts/[id]`）。ドラフト行を `FOR UPDATE` でロックしてから状態を再確認し、`materializeResultDraft` を同一トランザクションで実行することで、二重承認による重複 materialize を防ぐ。承認済みの `mail_messages` は `triage_status='processed'` に同期される。却下は `pending_review` / `parse_failed` のみ可能で理由必須。

`result_parse` ジョブハンドラ（`apps/mail-worker/src/result-import/run.ts` の `runResultParse`）は解析結果を `result_drafts` に UPSERT する。既存ドラフトが `approved`/`pending_review` なら上書きせず、`parse_failed`/`rejected`/`superseded` のときだけ再取込で置き換える（`triggerResultParse` の状態ガードと同じ方針をワーカー側でも二重に持つ）。解析失敗時は `status='parse_failed'` として `parseError` を保存し、承認は不可・却下のみ可能な画面になる。

### 大会系列（series）・開催（edition）の解決

大会名の文字列（例:「第27回こばえちゃ山形酒田大会C級」）から `tournament_series`（系列マスタ）・`tournament_series_editions`（開催＝回次マスタ）を解決するロジックが `apps/web/src/lib/edition/resolve.ts` に集約されている。結果取込・大会案内承認の双方から利用される共通コアで、**名寄せは100%自動にしない**方針を貫く。

- `parseAnnouncementName` が大会名から「第N回」の回次と、回次・末尾の級サフィックス（「A級」「A・B級」「(A〜C級)」等）を除いた系列名候補を抽出する
- `normalizeForMatch`（NFKC・空白/区切り記号除去）で正規化した文字列同士を比較し、`scoreSeries` が完全一致=100・部分包含=50でスコア付けする
- `autoResolveEdition`（結果取込 flow②で使用）は「系列が正規化完全一致かつ単独最良」かつ「回次が取れた」ときだけ `findOrCreateEdition` を呼んで自動 link する。曖昧・新規系列・回次不明のときは link せず候補一覧を返すのみ（誤った大会への紐付けを避ける）。新規系列は自動作成しない
- `findOrCreateEdition` は親 `tournament_series` 行を `FOR UPDATE` でロックしてから `UNIQUE(series_id, edition_number)` で解決/新規作成する。既存 edition が `unconfirmed`（大会案内承認時点で作成）で今回 `held`（結果取込）が解決された場合はライフサイクルを `held` に確定し、`year`/`rawName` が未設定なら補完する（既存値は上書きしない）
- `findOrCreateSeries` は完全一致が単独のときだけ既存系列を返し、複数一致は曖昧としてエラー、未一致は `allowCreate` が明示されたときのみ新規作成する（silent な新規マスタ化を防ぐ）。系列の `kind`（individual/team）と紐付け要求の不一致もエラーにする

このコアは大会案内承認（`tournament_drafts` → `events` 作成。`apps/web/src/app/(app)/admin/mail-inbox/actions.ts` の `approveDraftUnits` 等）からも呼ばれるが、`events`・大会申込の画面/フローそのものは [spec/events-attendance.md](events-attendance.md) が正典。ここでは edition/series 解決ロジックのみを正典として扱う。

### 参加名簿（申込/確定）の取込

`apps/web/src/lib/roster-import/parser.ts`（`parseRosterGrid`）が名簿 Excel をヘッダ語検出で解析し（氏名/姓+名・ふりがな・級・所属・段位・出場状態列を任意組み合わせで許容）、`materialize.ts`（`materializeRoster`）が `tournament_entry_rosters` / `tournament_entry_roster_entries` へ確定保存する。

- **再取込は置換**: 同一 `(event_id, roster_type)` の既存名簿を削除（`ON DELETE CASCADE` でエントリも消える）してから作り直す。繰上りの反映は確定名簿の再取込で行う
- 各行の選手も `result-import` と同型の get-or-create（正規化姓名キーのみ、`onConflictDoNothing`）で `players` に解決する
- 会員突合: 正規化姓名が会員（`users.name`）に**単独一致**したときだけ `entry.userId` を張る（曖昧は `null`）
- 出場状態（`roster_entry_status`）はファイルの状態列テキストから `mapEntryStatus` でマップする。繰上（繰上/繰り上）表記をまず判定し、その中で辞退/不参加を伴うものだけを `carried_up` より先に `carry_up_declined` とする順序が重要（そうしないと「繰り上げ辞退」が出場扱いに倒れる）。名簿は外部事実として扱い、取込では出欠を自動更新しない

呼び出し元の Server Action（`importRoster` 相当。個人戦大会のみ対象）は `apps/web/src/app/(app)/events/[id]/actions.ts` にあり、画面は大会詳細（events ドメイン）側。名簿の取込ボタン・UI の詳細は [spec/events-attendance.md](events-attendance.md) を参照。ここでは解析・確定保存ロジックのみを正典として扱う。

## 画面

### `/tournaments`（大会結果・年別一覧）

全大会を開催日降順・年セクションで一覧表示する。行に級構成トーンドット（`GradeDots`）と参加者数を出し、行タップで大会詳細へ遷移する。中止回は「中止」表示・参加者数は「—」。`short_name`（通称）が edition 経由で解決していれば「通称＋開催級（A→E順連結）」を行タイトルに合成し、無ければ大会の正式名称にフォールバックする（この合成は年別一覧に閉じており、大会詳細・シリーズ詳細・選手詳細は常に正式名称）。「もっと見る」は Server Action `loadMoreTournaments`（`apps/web/src/app/(app)/tournaments/actions.ts`）でオフセット追記する。

大会別（`/tournaments/series`）とはヘッダ（`TournamentsHeader`）のトグルで切り替え、大会名検索（`?q=`）は両ビュー共通。表示に使う集計クエリ（`getTournamentList` / `getSeriesList` 等）は `lib/stats/` 配下（stats ドメイン管轄）。

### `/tournaments/series`・`/tournaments/series/[id]`（大会別＝系列一覧・詳細）

系列を1行に束ねて累計開催回数・回次範囲・直近年・状態内訳（開催/中止/未確定）を表示する一覧と、系列詳細（回次一覧＋参加者数推移チャート）。回次一覧は結果データのある回（`tournamentId` あり）のみ大会詳細へタップ可能で、中止・記録なしの回は非タップ表示にする。

### `/tournaments/[id]`（大会詳細）

大会の入賞者タブ（全級ブロック横断の1〜4位）と級タブ（選手×回戦のクロス表、勝ち上がり順・敗退後は空欄）を切り替えるプッシュ画面。`?from=` で戻り先（一覧/シリーズ詳細どちらから来たか）を保持する（内部パスのみ許可。オープンリダイレクト防止）。クロス表の行タップは戦績詳細（players ドメイン）へ遷移する。表示データの集計・型（`ClassBlock` / `CrosstabCell` 等）は `lib/stats/results.ts`（stats ドメイン管轄）。

### `/admin/mail-inbox/result-drafts/[id]`（結果ドラフト承認）

ルートは mail-inbox（メール受信箱）配下だが、結果取込の承認・却下という本ドメインの中核操作を行う画面のため本書が正典として扱う。ドラフトの状態（承認待ち/承認済み/却下/取込失敗/差替済み）に応じた表示切り替え、解析結果プレビュー（級ごとの参加者数・試合数、参加者上位10名の順位/氏名/所属/勝敗数）、承認フォーム（大会名必須・開催日/会場任意）、却下ボタン（理由必須のテキストエリア）を持つ。`parse_failed` は却下のみ可能（承認不可）。

## フロー

### 結果取込フロー（メール添付Excel）

1. 管理者がメール詳細で添付Excelを指定し「結果として取り込む」→ `triggerResultParse` が `mail_worker_jobs`（`kind='result_parse'`）を作成（既存ドラフトが `pending_review`/`approved` ならエラーで弾く）
2. mail-worker のタイマーが `runResultParse` を実行: `readExcel` → `parseResultExcel` → `result_drafts` を UPSERT（`pending_review` または `parse_failed`）。Web Push で管理者へ完了通知（best-effort）
3. 管理者が `/admin/mail-inbox/result-drafts/[id]` でプレビューを確認し、大会名・開催日・会場を入力して承認、または理由を入力して却下
4. 承認時は `approveResultDraft` → `materializeResultDraft` が同一トランザクションで実行され、`tournaments`/`tournament_classes`/`tournament_participants`/`matches` が確定保存される。以後この大会結果は `/tournaments/[id]` 等の閲覧画面（stats ドメイン集計経由）に反映される

### 名簿取込フロー

管理者が大会詳細（events ドメイン画面）から申込名簿/確定名簿の Excel をアップロード → `readExcel` → `parseRosterGrid` → `materializeRoster` を1トランザクションで実行。パース不能（氏名列を検出できない）ファイルは DB を汚さず即エラーになる。

## API（Server Actions / ジョブハンドラ）

- `triggerResultParse(mailId, attachmentId)` — `.xls`/`.xlsx` 添付を指定して `result_parse` ジョブを積む。既存ドラフトの状態ガードあり（`apps/web/src/app/(app)/admin/mail-inbox/actions.ts`）
- `approveResultDraft(draftId, formData)` — 大会名/開催日/会場を受け取り `materializeResultDraft` を実行、`result_drafts.status='approved'` に遷移。`FOR UPDATE` で二重承認をガード
- `rejectResultDraft(draftId, reason)` — `pending_review`/`parse_failed` のドラフトを理由付きで却下
- `runResultParse(opts)`（`apps/mail-worker/src/result-import/run.ts`）— ジョブ本体。Excel 読込・解析・`result_drafts` UPSERT・`mail_worker_runs` 記録・Web Push 通知
- `materializeResultDraft(tx, payload, opts)`（`apps/web/src/lib/result-import/materialize.ts`）— 解析済みペイロードから確定テーブル群への書き込み本体。呼び出し元トランザクション内で実行する前提（単体では commit しない）
- `autoResolveEdition` / `findOrCreateEdition` / `findOrCreateSeries` / `suggestEditionFromName`（`apps/web/src/lib/edition/resolve.ts`）— 系列・開催の解決 API 群。結果取込・大会案内承認の双方から呼ばれる共通コア
- `loadMoreTournaments(query, offset)`（`apps/web/src/app/(app)/tournaments/actions.ts`）— 年別一覧の追加読み込み（audience=全ログインユーザー、認証必須）
- 名簿取込 Server Action（`parseRosterGrid` → `materializeRoster` を呼ぶ）は `apps/web/src/app/(app)/events/[id]/actions.ts` にある（画面・呼び出し導線は events ドメイン管轄）
