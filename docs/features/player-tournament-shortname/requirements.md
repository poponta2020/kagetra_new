---
status: completed
design_required: false
---
# player-tournament-shortname 要件定義書

## 1. 概要
- **目的:** 統計画面の選手まわり2画面で表示される「大会名」を、正式名称ベースの表記から「大会シリーズの通称（`tournament_series.short_name`）＋選手の出場級」の合成表示に変更する。
- **背景・動機:** 大会結果統計（`/tournaments` 大会別一覧）では既に通称表示（例「大阪ABC」）が実装済み（`tournamentDisplayTitle`, `TournamentYearList.tsx`）。選手個人の戦績側（検索結果・戦績詳細）はまだ正式名称ベースの表記のままで、会内で使う短い通称と表記が揃っていない。データ（`tournament_series.short_name`）は既に180系列分が本番投入済みのため、**追加のデータ整備は不要**、表示ロジックの追加のみで実現できる。

## 2. ユーザーストーリー
- **対象ユーザー:** 統計画面で選手を検索・閲覧する全ログインユーザー（会員）。
- **ユーザーの目的:** 大会名を長い正式名称（例「第40回高松宮記念杯近江神宮全国大会」）でなく、会内で通じる短い通称＋出場級（例「高松宮A」）でパッと識別したい。
- **利用シナリオ:**
  1. 選手検索結果一覧の各行「最終出場：YYYY/MM（大会名 結果）」で、大会名部分が通称＋出場級になる。
  2. 選手をタップして開く戦績詳細画面 `/players/[id]` の年別大会見出しでも、同じ通称＋出場級で表示される。
  3. 通称が未設定、またはシリーズ未紐付きの大会は、現行同様「正式名称から『第N回』を除去した表記」＋出場級にフォールバックする（表示が消えたり空欄になったりしない）。

## 3. 機能要件

### 3.1 画面仕様

**対象画面A: `/players`（選手検索結果一覧・`PlayerResultRow.tsx`）**
- 各行の「最終出場：YYYY/MM（大会名 結果）」の大会名部分を変更。
- **現行:** `lastTournamentName`（正式名称そのまま。「第N回」を含む） を無加工表示。
- **変更後:** `通称 + 出場級`（例「大阪A」）。通称が使えない場合は「正式名称から『第N回』を除去したもの」＋出場級にフォールバック（＝この画面にも新たに『第N回』除去を導入）。
- 級の表示は今回**新規追加**（現行はこの行に級を一切出していない）。
- それ以外（日付・結果・レイアウト）は変更しない。

**対象画面B: `/players/[id]`（選手戦績詳細・年別大会見出し）**
- **現行:** `stripKai(tournamentName) + grade`（正式名称から「第N回」を除去し、出場級を後置。例「北海道選手権A」）。
- **変更後:** 通称が使えるときは `shortName + grade`（例「大阪A」）。通称が使えないときは現行と同じ `stripKai(tournamentName) + grade` にフォールバック（見た目の後退なし）。

**共通仕様**
- **級の範囲＝その選手がその参加で出場した1級のみ**（大会全体で開催された全級ではない。例：大会全体はABC開催でも本人がA級のみ出場なら「大阪A」）。
- **回次（「第〇〇回」）は表示に含めない**（ご提示例の「第〇〇回大阪AB」から回次部分は除く、との確認済み）。
- 級が不明（`grade` が null）の参加は級表記なし（通称またはフォールバック名のみ）。
- 通称・正式名称のどちらの場合も、大会名と級の間に区切り文字は入れない（既存 `/tournaments` の「大阪ABC」表記と同じ連結スタイル）。

### 3.2 ビジネスルール
- **通称の解決経路:** `tournaments.edition_id → tournament_series_editions.series_id → tournament_series.short_name`（3ホップ）。`short_name` は既存 migration 0038 で180系列に投入済み・本番稼働中。**新たな大会シリーズマスタ整備は不要**。
- **優先順位:** `short_name` が非 null → `short_name + grade`。`short_name` が null（`edition_id` 未設定、または紐付いた series の `short_name` 未設定）→ `stripKai(正式名称) + grade`。
- **後方互換:** 戦績詳細画面（対象画面B）は通称が使えない大会について現行と全く同じ見た目を維持（回帰なし）。選手検索結果一覧（対象画面A）は通称が使えない大会でも「第N回」を新たに除去する仕様変更になる（両画面の表記ルールを統一するため）。

### 3.3 エラーケース・境界条件
- `short_name` null・`edition_id` null・級 null は全て上記フォールバック規則で吸収し、表示が欠落することはない。
- 通称データの追加投入・修正は本機能のスコープ外（既存180系列のデータをそのまま使う）。

## 4. 技術設計

### 4.1 API設計
新規エンドポイントなし。既存のサーバーサイド関数（Server Component から直接呼ばれる読み取り専用クエリ）の戻り値を拡張する。

### 4.2 DB設計
変更なし。既存の `tournament_series.short_name`（migration 0038）／`tournaments.edition_id`（migration 0033）／既存 Drizzle relations（`tournaments.edition → tournamentSeriesEditions.series → tournamentSeries`）をそのまま利用する。

### 4.3 フロントエンド設計
- **新規共有モジュール** `apps/web/src/lib/players/tournamentLabel.ts`
  - `stripKai(name: string): string` — 現行 `page.tsx` 内のプライベート関数をここへ移設。
  - `formatTournamentLabel(t: { name: string; shortName: string | null; grade: string | null }): string` — `t.shortName ?? stripKai(t.name)` に `t.grade ?? ''` を連結する純関数。ユニットテスト先行（`tournamentLabel.test.ts`）。
- **`apps/web/src/app/(app)/players/[id]/page.tsx`**: ローカル `stripKai` 定義を削除し、新モジュールの `formatTournamentLabel` を呼び出す形に置換。`participations` 由来の `shortName` を渡す。
- **`apps/web/src/app/(app)/players/components/PlayerResultRow.tsx`**: `lastTournamentName` 直接表示を、`lastTournamentName`/`lastShortName`/`lastGrade` から `formatTournamentLabel` で組み立てた文字列の表示に置換（`lastTournamentName` が null＝出場記録なし、の判定ロジックは変更しない）。

### 4.4 データ取得層設計（`apps/web/src/lib/players/queries.ts`）
- **`getPlayerRecord`**: `tournamentParticipants.findMany` の `with.class.with.tournament` に `with: { edition: { with: { series: { columns: { shortName: true } } } } }` を追加。`PlayerParticipationView` に `shortName: string | null` を追加（`p.class.tournament.edition?.series?.shortName ?? null`）。既存フィールド（`tournamentName` 等）は変更しない。
- **`searchPlayers`**: `latest` LATERAL サブクエリに `tournamentSeriesEditions`・`tournamentSeries` への `leftJoin` を追加し、`short_name` と（同ラテラル内で既に JOIN 済みの）`tournamentClasses.grade` を select に追加。`PlayerSearchResult` に `lastShortName: string | null` と `lastGrade: 'A'|'B'|'C'|'D'|'E'|null` を追加。既存フィールド（`lastTournamentName` 等）は変更しない。

## 5. 影響範囲
- `apps/web/src/lib/players/queries.ts`（型拡張＋クエリJOIN追加。既存フィールドはそのまま＝後方互換）
- `apps/web/src/app/(app)/players/[id]/page.tsx`（表示ロジック差し替え、ローカル `stripKai` 撤去）
- `apps/web/src/app/(app)/players/components/PlayerResultRow.tsx`（表示ロジック差し替え）
- 新規 `apps/web/src/lib/players/tournamentLabel.ts` ＋ `tournamentLabel.test.ts`
- 既存テスト更新: `apps/web/src/lib/players/queries.test.ts`（新フィールドのテスト追加。既存 `tournamentName`/`lastTournamentName` アサーションは変更不要）、`PlayerResultRow.test.tsx`（表示文字列アサーションを新フォーマットに更新）
- DB・migration: 変更なし
- design-spec: 不要（`design_required: false`。既存デザイン語彙内の文言差し替えのみで新規UI要素・新規状態を伴わない。`PlayerResultRow` への級追加も既存の1行メタテキスト内の文字列変更に留まる）

## 6. 設計判断の根拠
- **専用関数として新設（既存 `tournamentDisplayTitle` を流用しない）:** `/tournaments` の通称表示は「大会全体の開催級（複数）」を対象にしているのに対し、本機能は「選手本人の出場級（単一）」が対象で、フォールバック時の「第N回」除去有無も両者で異なる（`/tournaments` は shortName null 時に正式名称をそのまま出す＝除去しない）。仕様が異なるため使い回さず、`formatTournamentLabel` として別関数にする。
- **回次（第N回）を含めない:** ご提示の例には回次が含まれていたが、既存の戦績詳細画面が可読性のため意図的に除去してきた経緯を踏襲する方針として確認済み。
- **データ整備なしで実現:** `tournament_series.short_name` は既に180系列分・本番投入済み（migration 0038）。本機能は表示層のみに閉じ、大会シリーズマスタの追加データ作業は行わない。
- **選手検索結果一覧のフォールバックも「第N回」除去に統一:** 2画面の表記ルールを揃えるため、検索結果一覧側にも新たに除去ロジックを導入する（詳細画面は現行動作を維持）。

## 進捗メモ
- 2026-07-05: コード調査（現状表示ロジック・`tournament_series`/`tournament_series_editions` の Drizzle 定義済み・`short_name` 本番投入済みを確認）→ ユーザーヒアリングで対象画面（2画面）・回次の要否（含めない）・フォールバック統一方針（両画面で第N回除去）・級の範囲（本人出場級のみ）・検索結果一覧への級追加（する）を確定。design_required=false（既存デザイン語彙内の文言差し替え）。
