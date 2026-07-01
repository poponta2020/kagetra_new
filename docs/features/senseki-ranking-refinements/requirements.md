---
status: completed
completed_sections: [ユーザーストーリー, 機能要件, 技術設計, 影響範囲]
next_section: null
design_required: false
---
# senseki-ranking-refinements 要件定義書

> 統計タブ「ランキング」画面（`/players/ranking`・[[project_senseki_stats_tab]] / PR#222
> [[impl_senseki_stats_pr3_ranking]] で実装済み）への **delta 改修（5件）**。画面の見た目・
> レイアウトは既存 design-spec（`docs/features/senseki-stats/`）のまま変えない＝本書はロジック/
> デフォルト値/データ/遷移の差分のみを扱う（`design_required: false`）。DB スキーマ変更なし・migration なし。

## 1. 概要

- **目的:** ランキング画面の「初期表示の実用性」「表示の正しさ」「回遊性」「級フィルタの意味」を改善する。
- **改修5件:**
  - ① デフォルト期間 = 直近5年
  - ② 所属会の表示バグ修正（全行同じ → 直近大会の所属）
  - ③ デフォルト級 = A級（ランキングタブのみ）
  - ④ 選手詳細からの「戻る」をランキングに（フィルタ復元付き）
  - ⑤ 級フィルタの母集団を「現級」に絞る＋「昇段済みの選手を含む」トグル

## 2. ユーザーストーリー

- 対象ユーザー: 全ログイン会員（統計タブの閲覧者）。
- ゴール:
  - ランキングを開いたら、まず見たい **現在A級・直近5年** の順位がすぐ出る（①③⑤の合成）。
  - 各行に **その選手の正しい所属会**（直近大会）が出る＝選手検索・戦績詳細と一致（②）。
  - ランキングから選手を見て戻ると、**さっき見ていたランキング（絞り込み条件そのまま）** に帰れる（④）。
  - 級で絞ったとき、既定は **今その級の人だけ**。過去その級だった人も見たいときは **トグルで切替**（⑤）。

## 3. 機能要件

### ① デフォルト期間 = 直近5年
- 絞り込み未指定で開いたときの期間デフォルトを「当年−5 〜 当年」にする。
  - 例: 当年 2026 → `yearFrom=2021, yearTo=2026`（年単位・当年含む、厳密な5年でなく年単位で可）。
- 当年はサーバー時刻（`new Date().getFullYear()`）から算出。
- **ランキングタブのみ**。他タブの集計は不変。

### ② 所属会の表示バグ修正（＋基準を期間内の直近に）
- 各行の所属会を、その選手の直近大会（`event_date` 降順 NULLS LAST・同日は `tournament.id` 降順）の
  participant 所属にする。所属無し/未参加は「所属不明」。
- **基準は「現在の期間フィルタ内での直近大会」**（点検で確定。⑤現級と**期間スコープを揃える**）。
  - 期間フィルタが全期間なら「通算で直近」＝実質これまでの選手検索と同じ。
  - 期間を絞った歴史ビューでは **その期間内の直近の所属**（当時の会名寄り）になる。
  - 級での絞り込みは所属の基準に**掛けない**（期間内・級不問の直近1件）。
- ⚠️ 副作用（許容）: 期間を絞ったランキングでは、所属会が **選手検索・戦績詳細ヘッダ（＝通算直近）と
  食い違う**ことがある。既定ビュー（期間が当年で終わる）ではほぼ一致。歴史ビューでの整合を優先した判断。
- 現状の不具合と原因・修正方針は §4.2。

### ③ デフォルト級 = A級
- 絞り込み未指定で開いたときの級デフォルトを「A級」にする（現状は全級）。**ランキングタブのみ**。

### ①③ 共通のデフォルト/絞り込み挙動（ユーザー確認済み）
- **絞り込み未指定（素の URL）／「クリア」ボタン** → デフォルト `級=A・期間=直近5年` を適用/復帰。
- **「全級」「全期間」も引き続き選べる**（確認: 残す）。絞り込みシートで級を全部 OFF＝全級、期間を
  「指定なし」＝全期間。その状態は **URL に保持**され、戻り時も復元。
- 実装: デフォルトを URL 省略で表す現行方式との衝突を避けるため、**「明示的に絞り込み中」フラグを
  URL に持たせる**（§4.3）。フラグ無し→デフォルト、有り→URL の値そのまま採用。ランキング parse 層に閉じる。
- デフォルトは **タブに入るたび（素の URL で来るたび）に適用**。前回条件の永続化はしない。

### ④ 選手詳細からの「戻る」をランキングに（フィルタ＋スクロール保持）
- ランキング一覧 → 選手タップ → 選手詳細（`/players/[id]`）で、上部導線を **「← ランキングへ戻る」** にする。
- **挙動＝ブラウザ戻る相当**（点検で確定）。押下で **`router.back()`** し、直前のランキング画面へ戻す。
  - **絞り込み条件（指標・期間・級・明示フラグ・includeFormer）は前 URL がそのまま復元**（history 由来）。
  - **スクロール位置も可能な範囲で保持**（App Router の back スクロール復元）。
  - **「もっと見る」で追加読み込みした行は復元されない場合がある**（クライアント state のため）。追加行を使って
    深くスクロールしていた場合はスクロール位置が末尾寄りにクランプされることがある＝許容。
- 実装補助: 詳細 URL に **`from=ranking`＋現在のランキング絞り込み params を複写**する。用途は
  (a)「ランキングへ戻る」ラベル判定、(b) `router.back()` が使えない直リンク流入時の**フォールバック
  遷移先**（`buildRankingHref` で再構成）、(c) 中クリック/JS 無効時の href。通常は `router.back()` を優先。
- 共存: 相手名タップ（`?from=<数値playerId>`）は現状維持、`from=ranking` と数値 `from` は排他判定。
  どちらでもない（検索直行等）→ 従来「← 選手検索へ戻る」。ランキング由来の詳細からさらに相手名タップ
  →以降は数値 `from` チェーンに切替（既存挙動、ランキング復元は「ランキング直下1階層」で担保）。

### ⑤ 級フィルタの母集団を「現級」に絞る＋「昇段済みの選手を含む」トグル
- **成績の数え方（分子/分母）は不変**：級Xでの勝ち/対戦・出場/優勝/入賞…（`filterConds` の `grade IN`
  は維持）。今回変えるのは **母集団（誰をランキングに載せるか）** だけ。
- **トグル「昇段済みの選手を含む」**（絞り込みシートの級選択の下）:
  - **OFF（既定）**: 母集団を「**現級 ∈ 選択級**」の人だけに制限（新挙動）。
  - **ON**: 母集団を制限しない（＝現状＝過去に級Xを打った人も全部載る）。
  - 文言は **「昇段済みの選手を含む」で確定**（点検で「A級では降級側なので方向が逆」と指摘したが、ユーザー判断で
    この文言を維持）。実装上の意味は「現級が選択級と異なる（昇級・降級・引退で級が変わった）選手も含む」。
- **「現級」の定義（確定）**: **期間フィルタ内**での **判明級（`tournament_classes.grade IS NOT NULL`）
  のみ**を対象にした **直近1件**の grade。直近の出場が級不明でも、その前の判明級を現級とする。
- **適用範囲: 6指標すべて**（出場/勝利/勝率/対戦/優勝/入賞）。トグルと母集団制限は全指標で同様に効く。
- **級フィルタ未指定（全級）のときはトグル・母集団制限とも無効**（全員のまま）。素の全級ビューは
  クエリも挙動も一切変わらない＝追加コストゼロ。
- ⚠️ 挙動変更: 級を掛けた既定ビュー（トグルOFF）は従来より表示人数が減る（現級勢のみ）。意図した変更で、
  ON にすれば従来と同結果。

### ①③⑤ の合成（重要・確認事項）
- ③でデフォルト級 = A、⑤でトグルOFF既定 = 現級のみ。**合成すると初期ビュー（素の URL）は
  「現在A級・直近5年」の人だけ**になる。過去にA級を打ったが現在A級でない選手は既定で表示されない。
  → ①③⑤の論理的帰結であり、⑤の「表示人数が減る＝意図した変更」と整合。強い実用デフォルトとして採用。
  過去A級勢を見たいときはトグルON、または全級/全期間へ。

## 4. 技術設計（delta）

### 4.1 対象ファイル（既存）
- `apps/web/src/lib/stats/ranking.ts` — ② 所属解決、⑤ 現級母集団CTE・`periodConds` 分離。
- `apps/web/src/lib/stats/types.ts` — ⑤ `StatsFilter.includeFormerGrade` 追加・`sanitizeStatsFilter`。
- `apps/web/src/app/(app)/players/ranking/metrics.ts` — ①③④⑤ の URL 入出力（明示フラグ・includeFormer・from）。
- `apps/web/src/app/(app)/players/ranking/page.tsx` — ①③ デフォルト適用・明示モード props 伝播。
- `apps/web/src/app/(app)/players/ranking/RankingFilterBar.tsx` — ①③ 適用/クリア href、⑤ トグルUI。
- `apps/web/src/app/(app)/players/ranking/RankingMetricChips.tsx` — ①③ 指標切替でモード保持。
- `apps/web/src/app/(app)/players/ranking/RankingList.tsx` — ④ 行→詳細リンクに `from=ranking`＋条件付与。
- `apps/web/src/app/(app)/players/[id]/page.tsx` — ④ 戻る導線の分岐（ranking 由来は BackButton を描画）。
- `apps/web/src/app/(app)/players/[id]/BackButton.tsx`（新規・client）— ④ `router.back()`＋href フォールバック。
- テスト: `ranking.test.ts`（② 複数選手・⑤ 現級/トグル）、`metrics.test.ts`（①③④⑤ URL）、
  `RankingFilterBar.test.tsx`（⑤ トグル）。

### 4.2 ② 所属会バグ 根本原因と修正方針
- **原因:** `getPlayerRanking` の `recentAffiliation(agg.playerId)` は集計サブクエリ `agg`（派生テーブル）
  の列 `agg.player_id` に相関させているが **相関が効かず単一値**として評価され、全行が同じ所属になる。
  一方 `searchPlayers`（OK）は **物理列 `players.id`** に相関している。既存テスト「直近大会の所属会を返す」は
  **選手を1人しか seed していない**ため相関不良でも偶然正しい値になり、バグ未検出（テストギャップ）。
- **修正方針:** 相関サブクエリを派生列に当てるのをやめ、**ランキング行取得後に playerId 群 → 直近所属を
  別クエリで解決してマージ**（`queries.ts` の相手所属解決 `inArray(tournamentParticipants.id, …)` と同型）。
  集計本体を汚さず単体テストも容易。具体手段（後段2次クエリ / LATERAL 等）は実装時確定。
- **基準は期間スコープ（点検で確定）:** 直近判定を **現在の期間フィルタ内**に限定する（`yearFrom/yearTo` を
  所属解決クエリにも渡す＝⑤の `periodConds` を再利用）。級では絞らない・級不問の直近1件。全期間なら通算直近。
- **テスト:** ① **所属の異なる2人以上**を seed し各行が別々の直近所属を返す（全員同じでない）こと、②
  **期間フィルタで直近が変わる**（期間を絞ると別大会の所属になる）ことを検証。

### 4.3 ①③ デフォルト & 明示フラグの URL 方式
- ランキングの parse/build 層（`metrics.ts`）に閉じる（共有 `sanitizeStatsFilter` の年/級検証は変更しない＝他タブ不変）。
- **明示フラグ**（param 名は実装で確定・例 `f=1`）:
  - **無し**（素の URL・クリア後）→ `parseRankingParams` がデフォルト `grades=['A']`, `yearFrom=当年-5`,
    `yearTo=当年` を注入。
  - **有り** → URL の値そのまま採用（`grades` 無し＝全級、`yearFrom/yearTo` 無し＝全期間）。
- `buildRankingHref(metric, filter, explicit)`: 非明示→metric のみ（フィルタ省略）／明示→フラグ＋明示 grades/years。
- `RankingFilterBar`: **適用**→常に明示モードで push（draft がデフォルト同値でも明示）。**クリア**→素の URL（フラグ無し）＝デフォルト復帰。
- 「明示かどうか」は page → 各コンポーネントへ boolean 伝播（既存 `StatsFilter` 型は据え置き）。
- 後方互換: 旧 URL（フラグ無しでフィルタ param のみ）の解釈は実装時に確定（無難には「明示 param があれば明示扱い」）。ランキングは新規機能でブックマーク利用は想定薄。

### 4.4 ④ 戻る導線（ブラウザ戻る相当）
- **ランキング一覧の行リンク:** `/players/[id]?from=ranking&<現在のランキング絞り込み params>`
  （metric・明示フラグ・grades・yearFrom・yearTo・includeFormer を現 URL と同形で複写）。
- **選手詳細 `page.tsx`:**
  - `from === 'ranking'` → 上部導線を **`router.back()` する小さな client コンポーネント（BackButton）** に。
    ラベル「← ランキングへ戻る」。スクロール保持のため back を優先。
    - フォールバック: 自身の searchParams から `parseRankingParams`→`buildRankingHref` で戻り先 URL を再構成し、
      BackButton の `href`（中クリック/JS 無効/直リンク流入で history が無い場合の遷移先）にする。
  - `from` が正の整数 → 既存「← {名前} の戦績へ戻る」（現状のまま `<Link>`）。それ以外 → 既存「← 選手検索へ戻る」。
- 通常フロー（ランキングからタップ流入）では history に前 URL があるので `router.back()` が確実に効き、
  フィルタ（前 URL）＋スクロールが復元される。「もっと見る」追加行の client state は復元対象外。

### 4.5 ⑤ 現級母集団 & トグル
- **型・検証（`types.ts`）:** `StatsFilter` に `includeFormerGrade?: boolean` 追加。`sanitizeStatsFilter` で
  boolean コアース（不正/未指定は false＝現級のみ）。grades 無しのときは実質無効だが値は保持可。
- **URL（`metrics.ts`）:** `buildRankingHref` は `includeFormerGrade === true` のとき `includeFormer=1` 付与
  （false は省略）。`parseRankingParams` は `firstParam` 経由で `'1'`/`'true'` を true に。
- **バックエンド（`ranking.ts`）:** `filter.grades?.length > 0 && !filter.includeFormerGrade` のときだけ、
  集計サブクエリ（`participantAgg`/`matchAgg` 両方）の WHERE に **1回だけ評価される** 現級 DISTINCT ON
  サブクエリで `players.id IN (...)` を1枚足す（**相関サブクエリにしない**）:

  ```sql
  players.id IN (
    SELECT player_id FROM (
      SELECT DISTINCT ON (tp.player_id) tp.player_id, tc.grade
      FROM tournament_participants tp
      JOIN tournament_classes tc ON tc.id = tp.class_id
      JOIN tournaments      t  ON t.id  = tc.tournament_id
      WHERE tc.grade IS NOT NULL
        AND <期間条件のみ>            -- ※ grade IN はここに入れない
      ORDER BY tp.player_id, t.event_date DESC NULLS LAST, t.id DESC
    ) cur
    WHERE cur.grade IN (<選択級>)
  )
  ```

  - **最重要の落とし穴①:** 現級CTEの WHERE に選択級（grade IN）を入れてはいけない。入れると「級Xを打った
    最新の参加」を拾い「最新の参加がたまたま級X」にならない。**判明級の最新1件を取ってから grade が選択級か**の順。
  - **落とし穴②（alias）:** このCTEは生SQLで tournaments を `t` にエイリアスするため、集計本体が使う drizzle の
    `tournaments.eventDate`（`"tournaments"."event_date"` に展開）を**そのまま流用できない**。CTE 内の期間条件は
    `t.event_date`／yearFrom・yearTo の生値で別途組む。`filterConds` から **期間だけの断片 `periodConds(filter)`**
    を切り出し、集計本体には従来どおり「期間＋grade IN」、CTE には「期間だけ（`t` alias 版）」を渡す。
  - DISTINCT ON の並びは `recentAffiliation` と同基準（`event_date DESC NULLS LAST, id DESC`）＝所属表示と現級判定の
    「直近」定義を一致させる。
  - `getPlayerRanking` 内の空ページ再カウント（`aggFor` 二度呼び）も同一 `safeFilter` を通すので自動整合。
- **UI（`RankingFilterBar.tsx`）:** 級セクションの下にトグル/チェックボックス「昇段済みの選手を含む」。draft
  `draftIncludeFormer` は `open` 時に filter から同期（既存パターン）。**級未選択時は非表示**（意味を持たないため）。
  `apply` で `next.includeFormerGrade = draftIncludeFormer`（true のときだけ set）。`clear` は従来どおり。
- **性能:** 母集団制限は participants を1回スキャンして DISTINCT ON で畳むサブクエリ1つ（O(参加者)の1パス、
  選手ごと相関ではない）。367k 行でもサブ秒。かつ **級フィルタ有り＋トグルOFF のときだけ発火**（既定全級ビューは無コスト）。
  集計本体（matches 約82万行）より軽い追加。将来は players に通算現級派生列を materialize する高速パスを後付け可能（今回はやらない）。

### 4.6 影響なしを明示
- 他タブ（選手検索 `/players`・大会統計 `/tournaments/stats` 等）のデフォルト/集計は不変。
- DB スキーマ変更なし・migration なし・materialize 列追加なし。

## 5. 影響範囲

- 変更ファイル: §4.1 の8ファイル＋テスト3本（新規ケース追加）。
- `page.tsx` / `actions.ts`（`loadMoreRanking`）は `StatsFilter` をそのまま渡すだけ→型にフィールドが増えれば
  自動伝播（追加改修は基本不要・確認のみ）。
- 既存の URL 直リンク/ブックマークの後方互換は §4.3 で確定。

## 6. 実装タスク分割（案）

依存とファイル競合を踏まえた順序（詳細は implementation-plan.md）:

1. **Task A（②所属会バグ）** — 独立。`ranking.ts`＋test。最初に単独でも ship 可。
2. **Task B（①③デフォルト＋明示フラグ）** — `metrics.ts`/`page.tsx`/`RankingFilterBar`/`RankingMetricChips`＋test。
3. **Task C（⑤現級母集団＋トグル）** — `ranking.ts`(periodConds/CTE)/`types.ts`/`metrics.ts`/`RankingFilterBar`＋test。B と
   同じ `metrics.ts`・filter シートを触るので **B の後**。
4. **Task D（④戻る導線）** — `RankingList`/`[id]/page`＋test。B の `buildRankingHref`/`parseRankingParams` を使うので **B の後**。

- 順序: A（任意タイミング）→ B → C・D（B 後、C と D は独立）。
- PR 粒度: ファイル競合が多いので **A を独立 PR**、**B→C→D をこの順で**（1PR ずつ、または B と D をまとめる等は実装/ship 時に判断）。

## 6.5 点検で確定した判断（矛盾・整合性チェックの結果）

要望①〜⑤を一枚に並べた整合性点検の結論と、ユーザー確定事項：

- **論理的な矛盾はなし**（実装不能な衝突は無い）。以下は「変に見える点」への確定判断。
- **⑤トグル文言:** 「昇段済みの選手を含む」で維持（A級では方向が逆だがユーザー判断）。§3⑤に注記。
- **②所属会の基準:** 「通算直近」→ **「期間内の直近」に変更**（⑤現級と期間スコープを揃える）。§3② / §4.2。
  - 残差: 期間内・級不問の直近と、⑤現級（判明級のみ）は、直近が級不明大会のとき別大会を指し得る（軽微・許容）。
  - 残差: 期間を絞ると選手検索・戦績詳細ヘッダ（通算直近）と会名が食い違い得る（歴史ビュー整合を優先・許容）。
- **④戻る:** 「Link 再遷移（TOP から）」→ **「ブラウザ戻る相当（`router.back()`・スクロール保持）」に変更**。§3④ / §4.4。
- **①③⑤合成の既定（現在A級・直近5年のみ）:** 各要望の論理的帰結。強い実用デフォルトとして採用（確認済み）。
- **「過去5年」=2021–2026（暦年6年）:** `yearFrom=当年−5`。ユーザー「年単位で可」・例と一致。
- **⑤「現級」は期間相対:** 期間を絞ると「その期間内の最終級」を現級とみなす（歴史ビューで妥当）。

## 7. 設計判断の根拠

- **①③をランキング parse 層に閉じる:** 「ランキングタブのみ」を共有 `sanitizeStatsFilter` を汚さず満たす。
- **②を後段マージで直す:** 派生テーブル相関の落とし穴を避け、確立済みパターン（相手所属解決）にそろえ、複数選手テストを容易に。
- **全級/全期間を明示フラグで残す:** ユーザー確認で「残す」。デフォルト省略方式との衝突を1フラグで解消。
- **④を URL param で決定的に:** 既存 `from` 方式と統一、ブラウザ back の不確実性回避、フィルタ復元を保証。
- **⑤の母集団制限を非相関 DISTINCT ON で:** 選手ごと相関（数万回）を避け1パスに。級フィルタ有り＋OFF 時のみ発火で既定無コスト。
- **①③⑤合成の強い既定（現在A級・直近5年）:** 各要望の論理的帰結。実用上最も見たいビューを初期表示にする。
