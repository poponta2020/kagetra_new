---
status: completed
design_required: false
completed_sections: [ユーザーストーリー, 機能要件, 技術設計, 影響範囲]
next_section: null
---
# stats-grade-population（級別 競技人口サマリー）要件定義書

## 1. 概要

- **目的:**
  1. 統計画面の大会統計タブ（`/tournaments/stats`）のサマリーに、フィルタリング期間中の**各級（A〜E）の競技人口**を表示する。
  2. 既存の級別競技人口グラフ（ドリル先 `/tournaments/stats/competitors` の各級パネル）も、**同じ「1人=1級」の計算方法に統一**する（追加要望 2026-07-03）。
- **背景・動機:** 全体の競技人口カードは既にあるが、級ごとの規模感が一目で見えない。級別×年推移はドリル先にあるが「期間合算での級別人数」はどこにも表示されていない。また既存ドリルの級別系列は「その級に1回以上出た人数」方式（昇級者が複数級に重複カウント）であり、新カードと数え方が食い違うと混乱するため揃える。
- **種別:** 既存画面の delta 改修（senseki-stats ④大会統計サマリーへの数値カード追加＋既存集計の数え方変更）。

## 2. ユーザーストーリー

- **対象ユーザー:** 会員全員（統計セクションの閲覧者。認証必須は既存踏襲・ロール制限なし）。
- **目的:** 期間を絞った状態で「その期間に各級で活動していた選手が何人いるか」を把握する。
- **利用シナリオ:** 期間フィルタで直近5年などに絞る → サマリーの級別カードで A〜E の競技人口を比較 → より深い年推移は既存の図5ドリルで確認。

## 3. 機能要件

### 3.1 画面仕様

- `/tournaments/stats` サマリーの**絶対数4カード（大会数/対戦数/競技人口/延べ参加）の直下**に、横長（full width）の「級別 競技人口」カードを **1枚追加**する。
- カード内は **A→E の5項目を1行グリッド（5列）**で表示。各項目＝級ラベル（`A級` 等・小さめ）＋人数（数値は既存 StatCard と同じく serif・tabular-nums。4カードより一段小さいサイズで5列に収める。単位「人」は省略しカード注記で補う）。
- 注記（ChartCard の note と同トーン）: 「期間内で最後に出場した級で1人ずつ数える」。
- 級トーン（`GRADE_TONES`）による着色は**しない**（数値カードのため。図1/図3の凡例色と混同させない。級ラベルは通常インク）。
- 期間フィルタ（`StatsPeriodFilter`）に連動する。級の並びは A→E 固定。
- データが無い級は `0` を表示（項目を消さない）。
- ドリルリンクは付けない（級別の年推移は既存の図5「級別比較 ›」で見られるため）。
- design-spec は作成しない（既存サマリーの StatCard/ChartCard 様式を踏襲する数値追加のみ。ユーザー確認済み 2026-07-03）。

#### 3.1.2 級別比較ドリル（`/tournaments/stats/competitors`）の数え方統一

- 画面レイアウト・系列構成（全級＋A〜E の縦スモールマルチプル）は**変更しない**。変わるのは各級パネルの数値（集計方法）のみ。
- 分析文（`METRIC_ANALYSIS.competitors`）に数え方の説明を追記する：各級のグラフは「その年に最後に出場した級」で1人ずつ数える（1人=1級）旨。全級（all）パネルの説明（その年に1度以上参加した選手数）は従来どおり。

### 3.2 ビジネスルール

- **競技人口の定義（既存踏襲）:** 期間内の大会に1回以上参加した選手＝`tournament_participants` の `player_id` 非 null の distinct 選手数。
- **級への割り当て（1人=1級・直近級方式）:** 期間内の **A〜E 級クラスへの参加のうち直近のもの**の級に、その選手を1人だけカウントする。
  - **直近の決定順:** `event_date` 降順 NULLS LAST → 同日は `tournaments.id` 降順 → 同一大会内で複数級に出現する異常データは grade 昇順（上位級を採用）。決定的（非決定な同率なし）。
    ※ NULLS LAST＝日付ありの参加を優先し、期間フィルタ無しで日付なし大会のみに出た選手も `tournaments.id` で決定的に割り当てる（選手検索の直近所属と同じ流儀）。
  - **grade なしクラス（名人・クイーン戦、F級など A〜E enum 外）は割り当て対象外。** 期間内に grade なしクラスにしか出ていない選手は級別内訳に含まれない。
  - したがって **A〜E の合計 ≦ 全体の競技人口カード**（差＝級なしクラスのみ出場の選手数）。合計一致は要件としない。
- **期間フィルタ:** 既存 `periodConds` を踏襲（年指定時は `event_date` なし大会が自然除外される挙動も既存どおり）。
- **級別比較ドリル（年別・級別グラフ）の数え方:** 「1人=1級」を**年単位**で適用する。各年について、その年内の A〜E 級参加のうち直近のもの（`event_date` 降順 → 同日 `tournaments.id` 降順 → 同大会内は grade 昇順）の級に1人だけカウントする。
  - サマリーカード＝**フィルタ期間全体**で直近級を1つ決める／年別グラフ＝**各年の中**で直近級を決める（集計バケット単位で同じ規則を適用する、という統一）。
  - 全級（all）系列は従来どおり「その年に1回以上参加した distinct 選手数」で変更しない。
  - この変更により各年の A〜E 合計 ≦ 全級（差＝その年 grade なしクラスのみ出場の選手数）。従来方式（級ごと distinct）では昇級年に複数級へ重複カウントされていた。
- **エラー/境界:** フィルタ入力は既存 `sanitizeStatsFilter` を通す（新規パラメータなし）。期間内データ0件なら全級 `0`。

## 4. 技術設計

### 4.1 API設計

- 新規エンドポイントなし。Server Component から `getStatsOverview` を呼ぶ既存構造のまま、戻り値を拡張する。

### 4.2 DB設計

- スキーマ変更なし。migration なし。既存の `tournament_participants` / `tournament_classes` / `tournaments` を読むだけ。

### 4.3 フロントエンド設計

- `apps/web/src/app/(app)/tournaments/stats/page.tsx`
  - 4カードグリッドの直下に級別競技人口カードを追加（page ローカルコンポーネント。既存 `StatCard`/`ChartCard` と同様の Card ベース）。
  - `ov.gradePopulation` を A→E 順で描画（`ALL_GRADES` を回す）。

### 4.4 バックエンド設計（集計）

- `apps/web/src/lib/stats/overview.ts`
  - `StatsOverview` に `gradePopulation: Record<Grade, number>` を追加（全級を常にキーに持ち、データなしは 0）。
  - `queryGradePopulation(period)` を新設し `getStatsOverview` の `Promise.all` に追加。
  - SQL 方針（選手ランキング改修の DISTINCT ON パターンを踏襲）:
    ```sql
    SELECT grade, count(*)::int AS cnt
    FROM (
      SELECT DISTINCT ON (tp.player_id) tp.player_id, tc.grade
      FROM tournament_participants tp
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      WHERE tp.player_id IS NOT NULL AND tc.grade IS NOT NULL {period}
      ORDER BY tp.player_id, t.event_date DESC NULLS LAST, t.id DESC, tc.grade ASC
    ) s
    GROUP BY grade
    ```
- `apps/web/src/lib/stats/detail.ts`（級別比較ドリルの数え方統一）
  - `queryCompetitorsDetail` の各級系列を「(選手, 年) ごとに直近級を1つ決めて級に割り当てる」方式へ変更。SQL 方針:
    ```sql
    SELECT grade, year, count(*)::int AS cnt
    FROM (
      SELECT DISTINCT ON (tp.player_id, extract(year FROM t.event_date))
             tp.player_id, extract(year FROM t.event_date)::int AS year, tc.grade
      FROM tournament_participants tp
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments t ON t.id = tc.tournament_id
      WHERE tp.player_id IS NOT NULL AND tc.grade IS NOT NULL
        AND t.event_date IS NOT NULL {period}
      ORDER BY tp.player_id, extract(year FROM t.event_date),
               t.event_date DESC, t.id DESC, tc.grade ASC
    ) s
    GROUP BY grade, year
    ```
    （年別系列は `event_date IS NOT NULL` が既存前提のため NULLS LAST 不要）
  - 全級（all）系列のクエリは変更しない。モジュール冒頭 doc の「全級は各級の単純合算ではない」の理由記述を新方式（合計 ≦ all・差は級なしのみ出場者）に合わせて更新。
- `apps/web/src/app/(app)/tournaments/stats/[metric]/page.tsx` — `METRIC_ANALYSIS.competitors` の分析文に級別パネルの数え方（1人=1級・その年最後に出場した級）を追記。
- テスト（テストファースト）:
  - `apps/web/src/lib/stats/overview.test.ts`（新カード集計）
    - 昇級選手（期間内 B→A）が A のみに1カウントされる
    - 期間フィルタで直近級が変わる（期間を昔に絞ると B にカウント）
    - grade なしクラスのみの選手が内訳に出ない（が全体 competitors には含まれる）
    - 同日複数大会・日付なし大会のタイブレークが決定的
    - データなし級が 0 で返る
  - `apps/web/src/lib/stats/detail.test.ts`（ドリル集計の方式変更）
    - 同一年内で B→A と昇級した選手がその年は A のみに1カウントされる（従来は B/A 両方）
    - 年をまたぐ昇級（2023 は B・2024 は A）は各年それぞれの級にカウントされる
    - 全級（all）系列は従来値のまま（distinct 選手数）
    - 既存テストのうち級ごと distinct 前提の期待値を新方式に更新（テスト変更は破壊ではなく仕様変更に伴う更新であることを PR 説明に明記）

## 5. 影響範囲

- **変更ファイル:**
  - `apps/web/src/lib/stats/overview.ts` — 型拡張＋集計1本追加
  - `apps/web/src/lib/stats/overview.test.ts` — テスト追加
  - `apps/web/src/app/(app)/tournaments/stats/page.tsx` — カード1枚追加
  - `apps/web/src/lib/stats/detail.ts` — `queryCompetitorsDetail` 各級系列の集計方法変更＋doc 更新
  - `apps/web/src/lib/stats/detail.test.ts` — テスト追加＋既存期待値の更新
  - `apps/web/src/app/(app)/tournaments/stats/[metric]/page.tsx` — 分析文の追記
- **既存機能への影響:**
  - `getStatsOverview` の戻り値はフィールド追加のみ（後方互換）。呼び出し元は stats page のみ。
  - `getStatsDetail(competitors)` の**各級系列の数値が変わる**（昇級者の重複カウント解消で従来より小さくなる年がある）。UI 構造・型は不変。score / participations 詳細、ランキング（`ranking.ts`）、サマリー図5（全級・年別）は無影響。
- **互換性:** API/DB スキーマ変更なし。URL パラメータ追加なし。

## 6. 設計判断の根拠

- **直近級方式（1人=1級）:** ユーザー選択（2026-07-03）。昇級者を現況の級で数え、A〜E 合計が全体競技人口とほぼ一致する直感的な内訳になる。
- **既存ドリルも同方式へ統一:** ユーザー追加要望（2026-07-03）。サマリーカードと級別グラフで数え方が食い違う混乱を避ける。年別グラフでは「1人=1級」を各年の中で適用する（期間全体の直近級で過去年まで塗り替えると歴史が歪むため。例：2015年にB級で出た参加が2024年の昇級でA級系列に移るのは不自然）。
- **A〜E のみ表示:** ユーザー選択。既存の級別比較ドリルと同じ割り切り。「その他」は表示しない。
- **カード1枚追加:** ユーザー選択。棒グラフは値ラベル廃止済み（PR#243）で正確な数値が読めないため、数値カードが要望（人数を表示したい）に合致。
- **design-screen スキップ:** ユーザー選択。既存様式踏襲の数値追加のみで視覚設計の新規論点なし。
- **タイブレークを選手検索の直近所属と同じ流儀に統一:** `event_date` 降順 NULLS LAST・同日 id 降順（PR#194 と一貫）。
