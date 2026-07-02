---
status: completed
---
# senseki-stats-refinements 実装手順書

> requirements.md（completed）準拠。1 PR・4タスク（前例 senseki-ranking-refinements PR#230 と同粒度）。
> DB 変更は Task 2 の migration 1 本のみ。テストファースト（既存 test ファイルへのケース追加が主）。

## 実装タスク

### タスク1: ① クロス表の選手列を画面左端へ
- [x] 完了
- **概要:** 大会詳細・級タブのクロス表で、スクロールラッパーの左パディングを外し選手列（sticky）を
  画面左端に密着させる。セル内テキストは `pl-4` 相当の内側パディングで可読性維持。右終端の
  見切れ防止（終端パディング）も維持。表示内容・列構成・タップ挙動は不変。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/tournaments/[id]/TournamentDetailTabs.tsx` — `CrosstabView` の
    ラッパー/選手セル（thead th＋tbody th）のクラス調整
  - `apps/web/src/app/(app)/tournaments/[id]/TournamentDetailTabs.test.tsx` — クラス断定があれば追従
- **依存タスク:** なし
- **対応Issue:** #232

### タスク2: ② 大会一覧（年別）を通称表示に（short_name マスタ新設）
- [ ] 完了
- **概要:** `tournament_series.short_name`（text・nullable）を新設し、180 シリーズの略称を
  バックフィル。年別一覧の行タイトルを「short_name＋開催級連結」（例: 大阪BC）にする。
  未紐付き/未設定は正式名称フォールバック。検索・他画面は正式名称のまま。
- **手順（タスク内の順序）:**
  1. 略称 180 件の案を生成 → `docs/features/senseki-stats-refinements/short-names.md` に一覧化
     → **ユーザーレビュー・承認**（このタスク内で完結させる）
  2. schema 変更＋migration（列追加＋承認済み略称の UPDATE 同梱・`name` キー・冪等。
     番号は journal 確認で採番＝並行ブランチ衝突回避）
  3. `getTournamentList` に series JOIN＋`shortName` 追加（テスト先行）
  4. 行タイトルの表示合成（テスト先行）
- **変更対象ファイル:**
  - `packages/shared/src/schema/tournament-series.ts` — `shortName` 列追加
  - `packages/shared/drizzle/`（migration 新規1本） — ADD COLUMN＋UPDATE 180件
  - `apps/web/src/lib/stats/tournaments.ts` — series JOIN・`TournamentListRow.shortName`
  - `apps/web/src/lib/stats/tournaments.test.ts` — 表示分岐（あり/なし/級空/未紐付き）
  - `apps/web/src/app/(app)/tournaments/TournamentYearList.tsx` — 行タイトル合成
  - `apps/web/src/app/(app)/tournaments/TournamentYearList.test.tsx` — 合成表示
  - `docs/features/senseki-stats-refinements/short-names.md`（新規） — レビュー用一覧
- **依存タスク:** なし
- **対応Issue:** #233

### タスク3: ③ 現級フィルタから「直近参加で優勝した B〜E級選手」を除外
- [ ] 完了
- **概要:** `currentGradeMembership` の DISTINCT ON サブクエリに `derived_bracket` を追加取得し、
  外側 WHERE に `AND NOT (cur.grade IN ('B'..'E') AND cur.derived_bracket = 1)` を追加。
  A級対象外・トグルON時は現行どおり。トグル説明文にひとこと追記。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/ranking.ts` — `currentGradeMembership` の除外条件
  - `apps/web/src/lib/stats/ranking.test.ts` — B級優勝直近は OFF で消える/ON で出る/
    A級優勝は消えない/昇段後新級出場済みは新級に出る（回帰）
  - `apps/web/src/app/(app)/players/ranking/RankingFilterBar.tsx` — トグル説明文の追記
- **依存タスク:** なし（ただしタスク4と同ファイルのため先に実施）
- **対応Issue:** #234

### タスク4: ④ 勝率ランキングの最低試合数を可変に
- [ ] 完了
- **概要:** `StatsFilter.minMatches`（勝率のみ使用・1〜1000 クランプ）を追加し、勝率の HAVING を
  `>= (minMatches ?? 20)` に。URL は 20 以外のときだけ `minMatches=` 付与（明示フラグと独立）。
  絞り込みシートに勝率タブ限定の「最低試合数」チップ（5/10/20/50/100・デフォルト20）を追加。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/types.ts` — `minMatches` 追加・`sanitizeStatsFilter` クランプ
  - `apps/web/src/lib/stats/types.test.ts` — sanitize（負値/小数/超過/文字列）
  - `apps/web/src/lib/stats/ranking.ts` — `DEFAULT_WIN_RATE_MIN_MATCHES` 化・HAVING 可変
  - `apps/web/src/lib/stats/ranking.test.ts` — 下限 5/50 で行数変化・デフォルト維持・他指標非影響
  - `apps/web/src/app/(app)/players/ranking/metrics.ts` — parse/build（20 省略）
  - `apps/web/src/app/(app)/players/ranking/metrics.test.ts` — URL 入出力
  - `apps/web/src/app/(app)/players/ranking/RankingFilterBar.tsx` — 最低試合数チップ（勝率のみ）
  - `apps/web/src/app/(app)/players/ranking/RankingFilterBar.test.tsx` — 表示条件・適用/クリア
- **依存タスク:** タスク3（`ranking.ts`・`RankingFilterBar.tsx` を共有するため直列）
- **対応Issue:** #235

## 実装順序

1. タスク1（依存なし・最小）
2. タスク2（依存なし・略称レビューをタスク内で完結）
3. タスク3（依存なし）
4. タスク4（タスク3の後・同ファイル共有）

## 備考

- 1 PR にまとめる（1機能=統計画面の delta 改修バッチ・前例 PR#230 と同粒度）。
- migration 番号は実装時に `packages/shared/drizzle/meta/_journal.json` を確認して採番（開発ルール11）。
- テストはローカルで `--no-file-parallelism`、worktree 並行時は `TEST_DATABASE_URL` で隔離
  （[[feedback_vitest_no_file_parallelism]] / [[feedback_shared_test_db_worktree_push_race]]）。
