# 統計（選手ランキング・大会統計）

> **責務:** 「統計」タブ配下の③選手ランキング・④大会統計の画面・集計仕様（期間/級フィルタの正規化、ランキング集計、大会統計サマリー＋図詳細、チャート描画ロジック）
> **関連画面:** `/players/ranking`（③選手ランキング）、`/tournaments/stats`（④大会統計・全体サマリー）、`/tournaments/stats/[metric]`（④大会統計・図詳細＝級別比較）
> **主要実装:**
> - `apps/web/src/lib/stats/types.ts`（`Grade`・`StatsFilter`・`RankingMetric`・`DetailMetric` と検証関数。db 非依存）
> - `apps/web/src/lib/stats/filters.ts`（期間 WHERE 断片 `periodConds`）
> - `apps/web/src/lib/stats/ranking.ts`（`getPlayerRanking`。③の集計本体）
> - `apps/web/src/lib/stats/overview.ts`（`getStatsOverview`。④全体サマリーの集計）
> - `apps/web/src/lib/stats/detail.ts`（`getStatsDetail`。④図詳細＝全級＋各級の集計）
> - `apps/web/src/lib/stats/grade-tones.ts`（級トーンランプ・系列ラベル）
> - `apps/web/src/lib/stats/series.ts`（`getSeriesList` / `getSeriesDetail`。集計契約のみ本書の対象。画面詳細は `tournaments-results.md` 参照）
> - `apps/web/src/lib/stats/results.ts`（`getTournamentResults`。集計契約のみ本書の対象。画面詳細は `tournaments-results.md` 参照）
> - `apps/web/src/app/(app)/players/ranking/page.tsx` / `metrics.ts` / `actions.ts` / `RankingMetricChips.tsx` / `RankingFilterBar.tsx` / `RankingList.tsx`
> - `apps/web/src/app/(app)/tournaments/stats/page.tsx` / `params.ts` / `[metric]/page.tsx`
> - `apps/web/src/components/stats/StatsPeriodFilter.tsx`（④専用の期間フィルタ UI）
> - `apps/web/src/components/stats/charts/chart-utils.ts` / `BarChart.tsx` / `Histogram.tsx` / `StackedComposition.tsx`（純 SVG チャート）
> - `apps/web/src/components/stats/section-tabs.tsx`（統計4セクション共有ナビ。選手検索・大会結果画面は `players.md` / `tournaments-results.md` 参照）

## 概要

「統計」タブは4セクション（選手検索／大会結果／ランキング／大会統計）で構成され、`SectionTabs`（4画面共通の上部ナビ・最長プレフィックス一致でアクティブ判定）で横断する。本書が正典として扱うのは③ランキングと④大会統計の2セクション。選手検索・戦績詳細は `players.md`、大会結果（年別一覧・大会詳細・シリーズ）と結果取込・derived_bracket 生成は `tournaments-results.md` が正典。

全画面ログイン必須（`auth()` が無ければ `/auth/signin` へ redirect）。集計は Server Component から直接 DB 読み取り（`getPlayerRanking` / `getStatsOverview` / `getStatsDetail`）、ページング用の「もっと見る」のみ Server Action（`loadMoreRanking`）を使う。

## 共通基盤（`lib/stats/types.ts` / `filters.ts`）

- `Grade`＝`'A'|'B'|'C'|'D'|'E'`。`ALL_GRADES` が正規順（A→E）を持ち、UI・URL の安定化に使う。
- `StatsFilter`＝`yearFrom` / `yearTo`（`tournaments.event_date` の年で絞る。片方だけでも可）、`grades`（③のみ有効。④は級で絞らない＝比較軸）、`includeFormerGrade`（⑤現級以外も含めるか。③のみ）、`minMatches`（勝率指標の最低試合数足切り。③のみ）。
- `sanitizeStatsFilter` が全ての入口（Server Action・searchParams）の choke point。年は整数・現実範囲（1900–3000）のみ通し `yearFrom>yearTo` は入替、`grades` は列挙外を除去、`minMatches` は 1〜1000 にクランプ。不正入力での DB エラー（500）を防ぐための唯一の検証点であり、`getPlayerRanking` / `getStatsOverview` / `getStatsDetail` はここを必ず通してから集計する。
- `coerceRankingMetric` / `coerceDetailMetric` は許可リスト外の指標を既定（`participations` / `score`）へ丸める。
- `filters.ts` の `periodConds(filter)` は生 SQL（`db.execute`）用に `tournaments` を alias `t` とした前提で年条件を `AND ...` 付きで返す（④の全クエリが使う）。`ranking.ts` 内の `filterConds` は Drizzle クエリビルダ用（期間＋級 IN）の別実装で、③のみが使う。
- 級の色は `grade-tones.ts` の `GRADE_TONES`（A=藍 `#2b4e8c` → E=砂 `#b8aa8a`。虹色でなく藍→砂の単調トーンランプ）と、全級（参照系列）用の中立トーン `ALL_SERIES_TONE`。朱（accent）はデータ装飾に使わない。`gradeTone(key)` / `seriesLabel(key)` が `'all' | Grade` を受けて色・ラベルを返す。

## 選手ランキング（`/players/ranking`）

### 指標

`RANKING_METRICS`（`ranking/metrics.ts`）が6指標を順に定義：出場回数（`participations`）／勝利数（`wins`。normal の win）／勝率（`winRate`。normal の勝ち/対戦、最低試合数で足切り）／対戦数（`matches`。normal の試合数）／優勝回数（`championships`。`derived_bracket=1`）／入賞回数（`nyusho`。`derived_bracket<=8`）。既定は `participations`。優勝/入賞は事前計算列 `tournament_participants.derived_bracket` を数えるだけで、大会詳細の入賞者判定（`results.ts`）とは独立の単純集計。

### URL 設計とデフォルト

`parseRankingParams` / `buildRankingHref`（`metrics.ts`）が searchParams ⇔ `{ metric, filter, explicit }` を往復する。`explicit`（URL の `f=1`）が無い「素の URL」は**強い実用デフォルト＝現在A級・直近5年（当年−5〜当年）**を注入した非明示ビュー。`f=1` が付く「明示モード」では URL の `grades` / `yearFrom` / `yearTo` をそのまま採用し、`grades` 無し＝全級・年無し＝全期間を表現できる。指標チップの切替・行→戦績詳細リンクは常に現在の explicit モードを保つ（`buildRankingHref` / `buildPlayerHrefFromRanking`）。`minMatches` は `f` と独立のパラメータで、既定値（20）以外のときだけ URL に載り、非明示ビューでも保持される。

### フィルタ（絞り込みシート）

`RankingFilterBar`（クライアントコンポーネント）が期間（年 from–to のセレクト2つ）・級（A〜E トグル複数選択）・級選択時のみ表示される「昇段済みの選手を含む」チェック・勝率指標のときのみ表示される最低試合数プリセット（5/10/20/50/100・単一選択）を持つボトムシート。ドラフト状態のみクライアントに置き、「適用」で常に明示モード（`f=1`）へ `router.push`、「クリア」で素の URL（デフォルトビュー）へ戻す。状態の単一ソースは searchParams。

### 現級母集団と優勝者除外（⑤）

`ranking.ts` の `currentGradeMembership(filter)` は、級フィルタ有り＋「昇段済みを含む」OFF のときだけ発火し、「現級（期間内・判明級のみの直近参加の級）が選択級に含まれる」選手だけに母集団を絞る。現級の決定は選手検索の直近所属解決と同じ並び（`event_date DESC NULLS LAST` → `id DESC`）。**B〜E級は優勝すると必ず昇段するドメインルール**があるため、現級を決めた「直近参加そのもの」で優勝（`derived_bracket=1`）した選手は「まだ次の大会に出ておらず旧級に残っているだけ」とみなし母集団から除外する（A級は優勝しても昇段しないため対象外）。`derived_bracket` が null（導出不能）の優勝は除外しない（優勝回数ランキングと同じ割り切り）。この母集団制限は「誰を載せるか」だけを変え、成績の数え方（分子/分母＝`filterConds` の grade IN）自体は変えない。

### ランキング集計とページング

`getPlayerRanking(metric, filter, limit, offset)` は指標別の集計サブクエリ（`participantAgg` または `matchAgg`。前者は `tournament_participants` 起点で出場/優勝/入賞、後者は `matches` 起点で勝利/対戦/勝率）に対して `rank() over (order by value desc)`（同値は同順位・次は順位を飛ばす）と `count(*) over ()`（該当総数）を1クエリで載せる。並びは値降順→表示名昇順→`playerId` 昇順（ページング境界の重複/欠落防止）。TOP 100 をデフォルトとし `offset` でページング。所属会は集計後に `resolveRecentAffiliations` で playerId 群を一括解決してマージする（派生列への相関サブクエリは全行が同じ所属になるバグを踏んだ既知の失敗パターンなので使わない）。`RankingList` は初期100行を props で受け取り、「もっと見る」で Server Action `loadMoreRanking`（`ranking/actions.ts`。未認証は `/auth/signin` へ redirect）を呼んで追記する。追加取得が空配列を返す・失敗するとそれぞれ「終端」「再試行可能なエラー」を UI で表示する。

行タップは `buildPlayerHrefFromRanking` で `/players/[id]?from=ranking&...` へ遷移し、現在の指標・explicit・フィルタを複写する（戦績詳細の「← ランキングへ戻る」導線・直リンク流入時のフォールバック遷移先の再構成に使う。詳細は `players.md`）。

## 大会統計（`/tournaments/stats` / `/tournaments/stats/[metric]`）

大会統計は**期間フィルタのみ**（`StatsPeriodFilter`。年 from–to のボトムシート。UI・URL 構造は `RankingFilterBar` の期間専用版）で、級では絞らない。級は比較軸（図内の A〜E 並置、または図詳細への「級別比較 ›」ドリル）として扱う。

### 全体サマリー（`getStatsOverview`）

4枚の絶対数カード（大会数／対戦数＝normal の勝者行のみで実試合数を1回だけ数える／競技人口＝distinct player／延べ参加＝`tournament_participants` 行数）と、級別競技人口カード＋6図を1回の `Promise.all` で並行集計する。

- **級別競技人口**：期間内・判明級のみの直近参加1件（`event_date DESC NULLS LAST` → `id DESC` → 同一大会内の複数級は `grade ASC` で決定的）の級に選手を1人だけ割り当てる「直近級方式」（1人=1級）。A〜E の合計は級なし出場者の分だけ総競技人口を下回り得る。
- **図1 級別構成の推移**：年×A〜Eの延べ参加を UI 側で100%積み上げに正規化（`StackedComposition`）。図内で完結（詳細ドリルなし）。
- **図2 新規参入者の推移**：初出場年は全データで確定した「真のデビュー年」で集計し、期間フィルタは表示する年の窓を絞るだけ。収録開始 2010 年は既存選手を含むため 2011〜のみ表示。
- **図3 一人当たり平均年参加数**：級別に (選手, 年) の distinct 参加大会数を平均。x軸=級（A〜E）。
- **図4 枚数差統計**：枚数差1〜25のヒスト＋加重平均。normal の勝者行のみ（試合を1回だけ数える）。図詳細（`score`）へドリル可。
- **図5/6 年別競技人口・年別大会参加人数**：年推移。図詳細（`competitors` / `participations`）へドリル可。

### 図詳細（`getStatsDetail`、`/tournaments/stats/[metric]`）

「全級（参照）」＋各級（A〜E）を `SERIES_KEYS = ['all', 'A', ..., 'E']` の順で縦スモールマルチプルに並べる。`[metric]` セグメントは `coerceDetailMetric` で許可リストへ丸め、不正値（例 `/tournaments/stats/bogus`）は丸めた canonical URL（`score`）へ redirect する（表示だけ差し替えると URL と戻る導線・期間フィルタの basePath が食い違うため）。

「全級」は各級の単純合算ではない：`competitors` の各級は「その年の直近級」で1人=1級に数える直近級方式なので A〜E合計 ≤ all、`participations` は級なし参加も含むため各級の和より多くなり得る。そのため all は per-grade とは別クエリで算出する。`score` 系列は級ごとの枚数差ヒスト＋平均。`competitors`/`participations` 系列は年昇順・データのある年のみ（0の年は落とし、UI 側 `denseYears` で全級の年域に揃えて0埋め）。詳細画面の score パネルには級ごとの分析文（`METRIC_ANALYSIS`。ページコンポーネントに埋め込みの固定テキスト）が付く。

### チャート実装

- `chart-utils.ts` の `niceStep` / `niceMax` / `axisTicks`：目盛本数の目標（5本）から「1/2/5×10ⁿ」のきりの良いステップを求め、軸上端をそのステップの整数倍へ切り上げる。`integer=true`（件数軸）では1未満へ落とさず整数刻みにし、0.25 のような重複ラベルを避ける。`denseYears` は年推移を連続年で0埋めし、`from`/`to` 明示（図詳細で全系列の年域を揃える）または データの min〜max を使う。
- `Histogram`（枚数差パレート図）：左軸（試合割合%）は**全図共通で 0〜10% 固定**（級間で高さを直接比較できるようにするため。個別正規化しない）、右軸（累積割合）は 0〜100% 固定。棒25本＋累積%の折れ線（中立インク実線）＋平均線（中立インク破線・数値ラベルのみ藍）。全体サマリーの図4は共通色（藍）・図詳細のパネルは級トーンで塗る。
- `StackedComposition`：年×A〜Eを各年100%に正規化した積み上げ棒。区切り線は surface ストローク。
- `BarChart`：件数/平均値の縦棒。全データが整数なら `integerAxis=true` で件数軸目盛にする。x軸ラベルは12本を超えると間引く。

## 大会結果の周辺集計（シリーズ・大会詳細）

`series.ts` / `results.ts` は物理的に `lib/stats/` に置かれるが、対応する画面（`/tournaments/series`・`/tournaments/series/[id]`・`/tournaments/[id]`）自体は `tournaments-results.md` の管轄。本書では集計契約のみ記す。

- `getSeriesList(query?)`：`tournament_series` と `tournament_series_editions`（開催台帳）を主ソースに、系列ごとの回次数・回次範囲・直近開催年・状態内訳（held/cancelled/unconfirmed）を返す。系列名の ILIKE 検索対応。
- `getSeriesDetail(seriesId)`：台帳（editions）を主ソースに、結果データ（`tournaments`・`edition_id` で紐付く）があれば参加者数・優勝者・遷移先大会を重ねる。優勝者は最上位級（A→E）優先で `derived_bracket=1`、導出不能級は `final_rank` に「優勝」を含み「準優勝」を含まない参加者へフォールバック（大会詳細の入賞者判定と同一の順位定義）。参加者数推移は記録ある年＋中止年（欠落明示）のみ。
- `getSeriesLotteryMetrics(seriesId)`：activeな級別factが明示参照する申込原本・抽選結果原本だけから、開催回×A〜E級の申込者数、当落内訳、倍率、定員未満時の残り枠・充足率を返す。後日の確定名簿発表、イベント全体定員、actual result、単なる最新rosterは倍率へ混ぜない。A級は各開催の申込開始日前日を基準日として、全申込者の公認／新春大会出場回数を2本目の集合SQLで一括算定し、主催者枠と回数帯別当落、厳密に定員線が横切る帯だけを境界として返す。シリーズ規模によらずSQLは2本で、`SeriesDetail.lotteryMetrics` へ個人情報を含まない集計値だけを統合する。
- 倍率とA級グラフの完全性は別契約。抽選結果の当選者数があれば倍率を出せても、主催者枠確認、選手同定、当落突合、年度履歴、級別定員、ルール版のいずれかが不足すればA級当落線は `incomplete` とし、推定境界を公開しない。定員が帯の終端と一致する場合は「帯内抽選」ではなく帯間の線として扱う。
- `getTournamentResults(tournamentId)`：1大会の級ブロック（`tournament_classes` 1行＝1ブロック、同一級が複数ブロックに分かれる場合はタブ名を A1/A2 に分岐）ごとに、入賞者（`derived_bracket` → 導出不能なら `final_rank` のベストエフォート抽出）とクロス表（選手×回戦。行は到達回戦降順→到達回戦での勝敗→bracket昇順→名前で「勝ち上がり順」に並べ、敗退後の回戦は欠落させることで逆三角形に見せる）を組む。

これらの読み取り専用の集計契約（優勝者定義・入賞順位定義・クロス表の並び）はランキングの優勝/入賞集計（`derived_bracket` を数えるだけの単純集計）とは別物であることに注意。ランキング側は導出不能級の `final_rank` フォールバックを行わない。

## 他ドメインへの参照

- 選手検索・戦績詳細・選手同定 → `players.md`
- 大会結果の年別一覧・大会詳細・シリーズ一覧/詳細の画面仕様、結果取込・materialize・`derived_bracket` の生成ロジック → `tournaments-results.md`
