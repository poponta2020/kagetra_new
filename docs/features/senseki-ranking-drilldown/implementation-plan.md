---
status: completed
---
# senseki-ranking-drilldown 実装手順書

> requirements.md（completed・design_required: false）準拠。**1 PR・3タスク**
> （前例 senseki-ranking-refinements PR#230 と同粒度）。DB 変更・migration なし。
> テストファースト（queries.test.ts が主戦場）。
> ⚠️ 並行注意: senseki-stats-refinements（実装待ち）と `ranking.ts` / `metrics.ts` が近接。
> 同時実装せず直列にする（機能的干渉はなし）。

## 実装タスク

### タスク1: getPlayerRecord のフィルタ拡張（データ層）
- [x] 完了
- **概要:** `getPlayerRecord(playerId)` に第2引数 `opts?: { filter?: StatsFilter; bracketAtMost?: 1 | 8 }`
  を追加。フィルタ指定時のみ、対象 participant id を軽量 join クエリ（tp→tc→t・期間/級/
  `derived_bracket` 条件）で先に絞り、既存 relational query に `inArray` を追加する。
  - 一覧（participations）は ①期間+級（＋②なら bracket）で絞る。
  - ヘッダ集計（totalWins/totalLosses・championships・nyushoCount・tournamentCount・activeYears）は
    **①母集合**（bracket 条件なし）で計算（②でも一覧と母集合を分ける）。
  - アイデンティティ（currentGrade・ヘッダ所属）はフィルタ時も**全成績ベース**で別取得
    （`searchPlayers` の相関サブクエリと同型）。
  - 期間・級の条件式はランキング集計（`ranking.ts` `filterConds`）とセマンティクス一致
    （export 共用 or 同形実装＋一致テスト。実装時にシンプルな方）。
  - フィルタ無し呼び出しは現行パスのまま（挙動不変・回帰テストで担保）。
- **テスト（先行）:** `queries.test.ts` — 期間のみ/級のみ/期間+級/明示全級・全期間/
  ② bracketAtMost=1・8（一覧のみ絞られヘッダは①母集合）/ヘッダ再計算値が `getPlayerRanking`
  同条件の値と一致（受け入れ基準の整合テスト・6指標対応値）/identity 不変/0件で record 非 null/
  フィルタ無し回帰/境界（年初年末・event_date null・grade null 除外）。
- **変更対象ファイル:**
  - `apps/web/src/lib/players/queries.ts` — getPlayerRecord 拡張
  - `apps/web/src/lib/players/queries.test.ts` — 上記ケース追加
  - （必要時）`apps/web/src/lib/stats/ranking.ts` — `filterConds` export 化のみ（挙動不変）
- **依存タスク:** なし
- **対応Issue:** #237（親 #236）

### タスク2: 条件表示行・解除 href の純関数（scopeLabel）
- [x] 完了
- **概要:** `[id]/scopeLabel.ts`（新規）に表示ロジックを純関数で切り出す:
  - `formatRankingScopeLabel(metric, filter)` — 「2021〜2026年・A級大会での成績」形式。
    全期間/全級/複数級（B・C級）/単年の分岐、②は「（優勝した大会のみ表示）」
    「（入賞した大会のみ表示）」を付す。
  - 解除 href 生成（現 searchParams 複製＋`all=1`・`from=ranking` 等維持）。
  - `metric` → `bracketAtMost` 変換（championships→1・nyusho→8・他→undefined）もここに置く。
- **テスト（先行）:** `scopeLabel.test.ts` — 文言分岐全パターン・解除 href の params 維持・
  bracket 変換。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/[id]/scopeLabel.ts`（新規）
  - `apps/web/src/app/(app)/players/[id]/scopeLabel.test.ts`（新規）
- **依存タスク:** なし（タスク1と独立・並行可だが直列実装で可）
- **対応Issue:** #238（親 #236）

### タスク3: page.tsx 配線（発火判定・条件行・解除導線・空状態）
- [x] 完了
- **概要:** `/players/[id]/page.tsx` で:
  - `fromRaw === 'ranking'` かつ `all !== '1'` のとき `parseRankingParams`（既存呼び出しに統合）の
    結果から `{ filter, bracketAtMost }` を組み `getPlayerRecord` へ渡す。
  - サマリー部に条件表示行＋「絞り込みを解除して全成績を見る」リンク（既存 `text-ink-meta` 系
    トーン・1〜2行）。
  - 絞り込み時の 0 件は「絞り込み条件に該当する大会がありません」＋解除リンク
    （非絞り込み時は従来文言のまま）。
  - `SensekiTimeline` / `BackButton` / ランキング側は変更なし。
- **テスト:** 既存テストの回帰（SensekiTimeline.test.tsx 等 green）。表示分岐は scopeLabel の
  単体テストでカバー済み（page はサーバーコンポーネントのため薄い配線に留める）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/[id]/page.tsx`
- **依存タスク:** タスク1・タスク2
- **対応Issue:** #239（親 #236）

## 実装順序

1. タスク1（データ層・依存なし）
2. タスク2（純関数・依存なし）
3. タスク3（配線・タスク1+2に依存）

1 PR（feature/senseki-ranking-drilldown）にまとめ、/implement → prepare-pr → auto-review-loop → ship。
