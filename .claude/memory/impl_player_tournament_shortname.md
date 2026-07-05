---
name: impl_player_tournament_shortname
description: player-tournament-shortname完了(PR#273 shipped)。選手検索結果一覧+戦績詳細画面の大会名表示を通称(short_name)+本人出場級に変更。Issue親#268/子#269-272全クローズ。design-spec不要(design_required:false)
metadata:
  node_type: memory
  type: project
  originSessionId: define-feature-2026-07-05
---

`/define-feature` で「統計画面の選手検索結果の各選手の結果表示画面、大会名をseries+通称+級表示に」を要件定義（2026-07-05）。

## 確定内容
- **対象2画面**: ①`/players`選手検索結果一覧の各行「最終出場：YYYY/MM（大会名 結果）」（`PlayerResultRow.tsx`）②`/players/[id]`戦績詳細の年別大会見出し（`page.tsx`）。
- **フォーマット**: `tournament_series.short_name + 本人の出場級`（例「大阪A」）。**回次（第〇〇回）は含めない**（ユーザーの最初の例には含まれていたが、既存の可読性重視の除去方針を踏襲する形でヒアリングにより不採用confirmed）。
- **級の範囲**: その選手の1参加=1級のみ（大会全体の開催級ではない。/tournaments大会別一覧の「大阪ABC」＝全級連結とは別ロジック）。
- **フォールバック**: short_name未設定/edition未紐付き→`stripKai(正式名称)+級`に統一（両画面とも常に「第N回」除去。検索一覧側は現状「第N回」を除去していない＝仕様変更を含む）。
- **PlayerResultRowに級を新規追加**（現状は級を一切表示していない）。

## 技術設計の核心
- **データは追加投入不要**: `tournament_series.short_name`は既にmigration 0038で180系列backfill済・本番稼働中（[[project_tournament_series_master]]参照・このセッションで9日前メモの誤り「Drizzle非定義」を訂正）。`tournaments.edition_id`FKも既存。表示層のみの変更。
- 新規共有純関数 `apps/web/src/lib/players/tournamentLabel.ts`（`stripKai`+`formatTournamentLabel`）。既存`/tournaments`の`tournamentDisplayTitle`（`TournamentYearList.tsx`）とは別関数（級の範囲とフォールバック挙動が異なるため使い回さない）。
- クエリ層拡張: `getPlayerRecord`（`queries.ts`）は既存relational query`with`に`edition.series.shortName`を追加、`searchPlayers`のLATERAL副問い合わせに`tournamentSeriesEditions`/`tournamentSeries`をleftJoin追加。既存フィールド（`tournamentName`/`lastTournamentName`）は非破壊で温存。

## 成果物
- `docs/features/player-tournament-shortname/requirements.md`（completed, design_required:false）
- `docs/features/player-tournament-shortname/implementation-plan.md`（completed, 4タスク）
- Issue: 親#268、子#269(純関数)/#270(クエリ層)/#271(戦績詳細)/#272(検索一覧)

## 実装〜出荷完了（2026-07-05）
- 4タスク全完了（タスク1(#269) `tournamentLabel.ts`+テスト新設 → タスク2(#270) `queries.ts`拡張+テスト3件追加 → タスク3(#271) `page.tsx`のローカルstripKai撤去 → タスク4(#272) `PlayerResultRow.tsx`差し替え+テスト更新）。全タスクmainのSonnetで直接実装（task-implementer委譲なし。影響範囲が薄く小さいため主エージェントが直接着手）。
- 落とし穴: `docs/features/player-tournament-shortname/`がメイン作業ツリーにuntrackedのまま（define-featureはcommitしない）で、originから作ったworktreeに無かった→手動cp+commitで補完（詳細は[[feedback_define_feature_docs_uncommitted]]）。ship時のmain ff-onlyでも同名untrackedファイルとの衝突が再発（内容確認の上で削除して解消）。
- **PR #273**: auto-review-loop 1R(effort=high, diff541行/9ファイル) pass・指摘0（Codexが一時ChatGPTクォータ上限に達し1回リトライ）。CI green→`/ship`でmerge `a207d06`・Issue親#268+子#269-272全自動クローズ。worktree削除済。
