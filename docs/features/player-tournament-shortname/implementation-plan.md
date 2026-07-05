---
status: completed
---
# player-tournament-shortname 実装手順書

> 入力＝[requirements.md](./requirements.md)（`design_required: false`・design-spec なし）。既存画面 `/players` と `/players/[id]` の表示ロジック改修のみ。新規 API/DB/migration なし。

## 実装タスク

### タスク1: 大会名フォーマット純関数＋ユニットテスト【テスト先行】
- [x] 完了
- **概要:** `stripKai`（「第N回」除去、既存 `page.tsx` のプライベート関数）を共有モジュールへ移設し、通称優先の合成ロジック `formatTournamentLabel` を新設する。
- **変更対象ファイル:**
  - `apps/web/src/lib/players/tournamentLabel.ts` — 新規。`stripKai(name: string): string`（既存正規表現 `^第[0-9０-９]+回\s*` をそのまま移設）／`formatTournamentLabel(t: { name: string; shortName: string | null; grade: string | null }): string`（`(t.shortName ?? stripKai(t.name)) + (t.grade ?? '')`）。
  - `apps/web/src/lib/players/tournamentLabel.test.ts` — 新規（先に書く）。ケース: shortName あり+grade あり／shortName あり+grade null／shortName null+正式名称に「第N回」あり／shortName null+grade null／全角数字の回次除去。
- **依存タスク:** なし
- **対応Issue:** #269

### タスク2: クエリ層の拡張（`getPlayerRecord` / `searchPlayers`）＋テスト【テスト先行】
- [x] 完了
- **概要:** 通称解決（`tournaments.edition_id → tournament_series_editions.series_id → tournament_series.short_name`）を両クエリに追加し、戻り値の型に通称・級フィールドを足す。既存フィールド（`tournamentName`/`lastTournamentName` 等）は変更しない（後方互換）。
- **変更対象ファイル:**
  - `apps/web/src/lib/players/queries.ts`
    - `getPlayerRecord`: `tournamentParticipants.findMany` の `with.class.with.tournament` に `with: { edition: { with: { series: { columns: { shortName: true } } } } }` を追加。`PlayerParticipationView` に `shortName: string | null` を追加し、マッピングで `p.class.tournament.edition?.series?.shortName ?? null` を設定。
    - `searchPlayers`: `latest` LATERAL サブクエリ（`tournamentClasses`/`tournaments` 既存 join 済み）に `tournamentSeriesEditions`・`tournamentSeries` への `leftJoin` を追加。select に `tournamentClasses.grade`（ラテラル内で既存 join 済み）と `tournamentSeries.shortName` を追加。`PlayerSearchResult` に `lastShortName: string | null` と `lastGrade: 'A'|'B'|'C'|'D'|'E'|null` を追加。
  - `apps/web/src/lib/players/queries.test.ts` — 追加ケース: series 紐付き大会（shortName 取得）／edition 未紐付き大会（shortName null）／series 紐付きだが short_name 未設定（shortName null）。`getPlayerRecord`・`searchPlayers` 両方で検証。既存テスト（`tournamentName`/`lastTournamentName` アサーション）は変更不要。
- **依存タスク:** なし（タスク1と並行可）
- **対応Issue:** #270

### タスク3: 戦績詳細画面 `/players/[id]` の表示差し替え
- [x] 完了
- **概要:** ローカル `stripKai` を撤去し、`formatTournamentLabel` を使って年別大会見出しの `title` を組み立てる。通称が使えない大会は現行と同じ見た目（回帰なし）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/[id]/page.tsx` — ローカル `stripKai` 関数定義を削除。`title: \`${stripKai(part.tournamentName)}${part.grade ?? ''}\`` を `title: formatTournamentLabel({ name: part.tournamentName, shortName: part.shortName, grade: part.grade })` に置換（`tournamentLabel.ts` から import）。
  - 既存のページレベルテスト（あれば）で見出し文字列のアサーションを更新。shortName ありのケースを追加。
- **依存タスク:** タスク1・タスク2
- **対応Issue:** #271

### タスク4: 選手検索結果一覧の表示差し替え（`PlayerResultRow`）
- [ ] 完了
- **概要:** 「最終出場：YYYY/MM（大会名 結果）」の大会名部分を `formatTournamentLabel` 経由の表示に差し替え、級を新規に付加する。`lastTournamentName` が null＝出場記録なし、の分岐ロジックは変更しない。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/components/PlayerResultRow.tsx` — `{player.lastTournamentName}` の直接表示を `{formatTournamentLabel({ name: player.lastTournamentName, shortName: player.lastShortName, grade: player.lastGrade })}` に置換（`lastTournamentName` は null チェック済みの分岐内なので non-null として渡せる）。
  - `apps/web/src/app/(app)/players/components/PlayerResultRow.test.tsx` — 表示文字列アサーションを新フォーマットに更新。shortName あり（級付き表示）／shortName なし（フォールバック＋第N回除去＋級表示）のケースを追加。
- **依存タスク:** タスク1・タスク2
- **対応Issue:** #272

## 実装順序
1. タスク1（依存なし）・タスク2（依存なし）— 並行実装可
2. タスク3（タスク1・2に依存）
3. タスク4（タスク1・2に依存）
