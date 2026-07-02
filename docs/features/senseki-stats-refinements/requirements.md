---
status: completed
completed_sections: [ユーザーストーリー, 機能要件, 技術設計, 影響範囲]
next_section: null
design_required: false
---
# senseki-stats-refinements 要件定義書

> 統計タブ（[[project_senseki_stats_tab]] PR#221-229・[[project_senseki_ranking_refinements_def]] PR#230
> で実装済み）への **delta 改修（4件）**。既存デザイン語彙内の小差分のため design-spec は作らない
> （`design_required: false`・ユーザー確認済み）。DB 変更は②の `tournament_series.short_name`
> 1 カラム＋バックフィルのみ（migration 1 本）。

## 1. 概要

- **目的:** 統計4画面の「表示の使い勝手」を細かく直す。
- **改修4件:**
  - ① 大会詳細・級タブのクロス表：選手列を画面左端に密着（現状は 16px の余白）
  - ② 大会一覧（年別）：正式名称でなく通称（例: 大阪BC）で表示（略称マスタ新設）
  - ③ ランキング現級フィルタ：B〜E級の「直近参加で優勝した選手」を昇段済みとして除外
  - ④ 勝率ランキング：最低試合数（現状20固定）をユーザーが変更可能に

## 2. ユーザーストーリー

- 対象ユーザー: 全ログイン会員（統計タブの閲覧者）。
- ゴール:
  - クロス表の横幅を最大限使え、スクロール中も選手名が画面端に固定されて見やすい（①）。
  - 大会一覧が会員の日常語彙（「大阪BC」「多摩A」）で一覧でき、走査が速い（②）。
  - 「今その級の人」フィルタに、実際にはもう昇段している優勝者が混ざらない（③）。
  - 勝率ランキングの足切りを緩めたり厳しくしたりして、見たい母集団で順位を見られる（④）。

## 3. 機能要件

### ① クロス表の選手列を画面左端へ

- 対象: 大会詳細（`/tournaments/[id]`）級タブのクロス表のみ（sticky テーブルはアプリ内でここ1箇所）。
- 現状: スクロールラッパーが `-mx-4 overflow-x-auto px-4` のため、テーブル（＝sticky の選手列）が
  画面左端から 16px 内側に始まり、固定時も左に余白が見える。
- 要件:
  - 選手列（ヘッダ「選手」＋各行の氏名セル）を**画面左端に密着**させる（フルブリード）。
  - 横スクロール時も現行どおり sticky で左端に固定される。
  - セル内テキストは左パディングを持ち、文字が画面端に貼り付かない。
  - 右端: スクロール終端で最終回戦列が画面右端に見切れず終わる（終端パディング維持）。
- 表示内容・列構成・タップ挙動は一切変えない（見た目の位置調整のみ）。

### ② 大会一覧（年別）を通称表示に

- **DB に略称は現状なし**（`tournament_series.aliases` は名寄せ用の正式名別表記であり表示略称ではない）。
  → **`tournament_series.short_name`（text・nullable）を新設**し、180 シリーズ分をバックフィルする。
- 行タイトルの表示規則（年別ビュー `/tournaments` のみ）:
  - `short_name` があり edition 紐付きの大会 → **`short_name` ＋ 開催級の連結**（正規順 A→E）。
    例: 大阪府の大会で B・C 級開催 → 「**大阪BC**」。
  - 開催級が空（名人戦・クイーン戦など A–E 外のみの大会）→ `short_name` のみ。
  - edition 未紐付き（実測 22/1,496 件）または `short_name` 未設定 → **現行どおり正式名称**（フォールバック）。
- 級トーンドット（GradeDots）は**併存維持**（級文字と重複するが視覚アイデンティティとして残す）。
- 大会名検索は**正式名称（`t.name`）のまま**（「大阪」は正式名にも含まれるため実用上困らない。
  「BC」等の級文字では検索できない＝許容）。
- 適用範囲は**年別一覧のみ**（ユーザー確定）。大会詳細ヘッダ・シリーズ一覧/詳細・選手詳細の対戦履歴は
  正式名称のまま。
- **バックフィルの進め方（実装タスク内）:** 私が 180 件の略称案を生成 →
  `docs/features/senseki-stats-refinements/short-names.md` に一覧化 → **ユーザーがレビュー・修正 →
  承認後に migration へ確定**。命名の目安: 地名・通称の最短形（大阪/多摩/京都/名人戦…）。
  迷うもの（同地名複数シリーズ等）はレビュー時に個別確認。

### ③ 現級フィルタから「直近参加で優勝した B〜E級選手」を除外

- 背景: B〜E級は優勝すると必ず昇段する（ドメインルール）。現級判定は「期間内・判明級の直近1件の
  grade」なので、**優勝したまままだ次の大会に出ていない選手**が旧級の現級母集団に残ってしまう。
- 要件（現行の⑤現級母集団制限への追加条件）:
  - **級フィルタ有り＋「昇段済みの選手を含む」トグル OFF** のとき、現級判定に使った**その直近参加
    自体で優勝**（`derived_bracket = 1`）しており、かつ**その級が B〜E** の選手を母集団から除外する。
  - **A級は対象外**（優勝しても昇段しないため現行どおり）。
  - **トグル ON は現行どおり**（母集団制限なし＝優勝者も表示）。
  - 成績の数え方（分子/分母・`grade IN`）は不変。変わるのは「誰を載せるか」だけ。6指標すべてに効く。
- 優勝の定義は **`derived_bracket = 1`**（優勝回数ランキングと単一定義）。
  - ⚠️ 既知の限界: ブラケット導出不能級（`derived_bracket` が null）の優勝者は除外できない
    （`final_rank` テキストへのフォールバックはしない＝優勝回数ランキングと同じ割り切り）。
- UI: 絞り込みシートのトグル説明文（「OFF＝選択級が現在の級の選手のみ。…」）に優勝者除外の含意を
  ひとこと追記する（文言は実装時に調整・レイアウト変更なし）。

### ④ 勝率ランキングの最低試合数を可変に

- 現状: `WIN_RATE_MIN_MATCHES = 20` のコード固定。
- 要件:
  - 絞り込みシートに「**最低試合数**」セクションを追加（**勝率タブのときのみ表示**）。
  - **プリセット選択式**（ユーザー確定）: `5 / 10 / 20 / 50 / 100` のチップから1つ選択。
  - **デフォルト 20**（現行維持）。「クリア」でも 20 に戻る。
  - URL パラメータで保持（デフォルト 20 のときは省略）→ 戻る導線（④'26-07 PR#230）でも復元される。
  - 指標を切り替えても値は保持し、勝率以外の指標では**無視**（集計に影響しない）。
  - 一覧の見出し「該当N人」・「もっと見る」ページングは新しい足切りに自動追従。
- 勝率の計算式・sub 表示（母数）は不変。他指標の HAVING（>0）は不変。

## 4. 技術設計（delta）

### 4.1 ① クロス表（フロントのみ）

- `apps/web/src/app/(app)/tournaments/[id]/TournamentDetailTabs.tsx` — `CrosstabView` の
  スクロールラッパー `-mx-4 overflow-x-auto px-4` から左パディングを外してテーブルを左端始まりにし、
  選手セル（thead th＋tbody th 両方）に `pl-4` 相当の内側パディングを移す。右終端の見切れは
  最終列側のパディング等で維持（具体クラスは実装時）。
- テスト: `TournamentDetailTabs.test.tsx`（クラス断定があれば追従）。

### 4.2 ② short_name マスタ＋年別一覧表示

- **スキーマ:** `packages/shared/src/schema/tournament-series.ts` に `shortName: text('short_name')`
  （nullable）追加。
- **migration（1本・番号は実装時に journal 確認で採番＝並行ブランチとの衝突回避）:**
  1. `ALTER TABLE tournament_series ADD COLUMN IF NOT EXISTS short_name text;`
  2. **承認済み略称 180 件の UPDATE を同梱**（`name` 一意キーで突き合わせ・該当なしは no-op・冪等）。
  - データを migration に同梱するのは、本番反映を auto-deploy の `db:migrate` に乗せて
    **手動バックフィル作業（残DoD）を作らない**ため（[[feedback_ship_dod_residual_check]]）。
  - レビュー用の全 180 件一覧は `short-names.md` として同 PR に含める。
- **クエリ:** `apps/web/src/lib/stats/tournaments.ts` `getTournamentList` の生 SQL に
  `LEFT JOIN tournament_series s ON s.id = e.series_id` を追加し `s.short_name` を select。
  `TournamentListRow` に `shortName: string | null` を追加。
- **表示合成:** 行タイトル `shortName != null ? shortName + grades.join('') : name`。合成は
  表示側（`TournamentYearList.tsx`）または row 生成時のどちらかに閉じる（実装時確定・テスト容易な方）。
- テスト: `tournaments.test.ts`（shortName あり/なし/級空/未紐付きの表示分岐）。

### 4.3 ③ 現級母集団の優勝者除外（`ranking.ts` のみ）

- `currentGradeMembership` の DISTINCT ON サブクエリに `tp.derived_bracket` を追加取得し、
  外側 WHERE を次に変更:

  ```sql
  WHERE cur.grade::text IN (<選択級>)
    AND NOT (cur.grade::text IN ('B','C','D','E') AND cur.derived_bracket = 1)
  ```

  - 「現級を決めた直近参加そのもの」で優勝判定する（別の過去大会での優勝は見ない）。優勝して
    昇段した選手は、次に新級で出場した時点で現級が新級に変わり自然に新級母集団へ入る。
  - 既存の落とし穴①②（現級サブクエリに選択級を入れない・`t` alias の期間条件）は現行コメントの
    まま維持。追加コストは select 列 1 個で、発火条件（級フィルタ有り＋トグルOFF）も不変。
- テスト: `ranking.test.ts` — (a) 直近参加が B級優勝の選手は B級フィルタ（トグルOFF）で消える、
  (b) トグル ON なら出る、(c) A級優勝は消えない、(d) B級優勝後に A級出場済みの選手は
  A級フィルタに出る（現行挙動の回帰）。

### 4.4 ④ 最低試合数（型 → URL → 集計 → UI）

- **型・検証（`types.ts`）:** `StatsFilter.minMatches?: number` 追加（**勝率のみ使用**と JSDoc 明記）。
  `sanitizeStatsFilter` で正の整数のみ採用・`1〜1000` にクランプ（プリセット外の URL 直打ちも
  安全に通す。表示上はチップ非選択状態で可）。
- **集計（`ranking.ts`）:** `WIN_RATE_MIN_MATCHES` を `DEFAULT_WIN_RATE_MIN_MATCHES` に改名し、
  winRate の HAVING を `NORMAL_GAMES >= (filter.minMatches ?? 20)` に。他指標は `minMatches` を参照しない。
- **URL（`metrics.ts`）:** `parseRankingParams` で `minMatches` を読み（不正は捨てる＝20扱い）、
  `buildRankingHref` は **20 以外のときだけ** `minMatches=` を付与。明示フラグとの関係:
  デフォルト注入（①③'PR#230）の対象外＝フラグ無しでも `minMatches` はそのまま読む（独立パラメータ）。
- **UI（`RankingFilterBar.tsx`）:** `metric === 'winRate'` のときのみ「最低試合数」セクションを級の下に
  表示。チップ `5/10/20/50/100`（単一選択・既存級チップと同トーン）。draft 状態は open 時同期の
  既存パターンに追従。適用で set・クリアで 20（=param 省略）。
- テスト: `ranking.test.ts`（下限 5/50 で行数が変わる・デフォルト 20 維持・他指標非影響）、
  `metrics.test.ts`（parse/build・20 省略）、`RankingFilterBar.test.tsx`（勝率のみ表示・適用/クリア）。

### 4.5 影響なしを明示

- ランキングの他フィルタ（期間・級・昇段者トグル・明示フラグ）と他タブ（選手検索・大会統計）の
  挙動は不変（③は既存トグル OFF 時の母集団のみ、④は勝率の HAVING のみ）。
- ②以外に DB 変更なし。②も列追加＋データ UPDATE のみで既存列・既存行タイトル以外の画面は不変。
- 検索・「もっと見る」・シリーズ画面・大会詳細は②の影響を受けない（表示合成は年別一覧に閉じる）。

## 5. 影響範囲

- 変更ファイル:
  - ①: `TournamentDetailTabs.tsx`（＋test）
  - ②: `tournament-series.ts`（schema）・migration 1本・`tournaments.ts`・`TournamentYearList.tsx`（＋test）・
    `short-names.md`（レビュー用一覧）
  - ③: `ranking.ts`・`RankingFilterBar.tsx`（説明文）（＋test）
  - ④: `types.ts`・`ranking.ts`・`metrics.ts`・`RankingFilterBar.tsx`（＋test）
- ③④が `ranking.ts`・`RankingFilterBar.tsx` を共有 → タスクは③→④の順で直列に実装。
- migration 番号は実装時に journal を確認して採番（並行ブランチ衝突回避・開発ルール11）。
- 既存 URL 互換: 新パラメータ（`minMatches`）は無ければ従来どおり。既存パラメータの意味変更なし。

## 6. 実装タスク分割（案）

前例（senseki-ranking-refinements PR#230＝5改修1PR）と同粒度で **1 PR・4タスク**:

1. **Task 1（① クロス表左端寄せ）** — 独立・最小。
2. **Task 2（② 通称表示）** — 独立（tournaments 側）。タスク内に「略称180件レビュー→承認」の
   ユーザー確認ステップを含む。
3. **Task 3（③ 優勝者除外）** — 独立だが ranking.ts を触る。
4. **Task 4（④ 最低試合数）** — Task 3 と同ファイルのため **Task 3 の後**。

順序: 1 → 2 → 3 → 4（2 の略称レビューは非同期にせずタスク内で完結させる）。

## 7. 設計判断の根拠

- **② short_name を series マスタに持つ:** edition 紐付き率 98.5%（1,474/1,496・ローカル実測）で
  180 件のバックフィルだけでほぼ全行をカバーできる。名前ヒューリスティックは表記ゆれに弱く
  「大阪BC」の級連結もできない。aliases は名寄せ用で意味が違うため流用しない。
- **② バックフィルを migration 同梱:** 手動本番作業（残DoD）を作らず auto-deploy に乗せる。
  180 件は固定マスタデータで migration に置ける規模。
- **③ 優勝判定を derived_bracket=1 に:** 優勝回数ランキングと単一定義。final_rank テキスト解釈を
  持ち込むと定義が分裂する。
- **③「直近参加そのもので優勝」に限定:** ユーザーの困りごと（優勝→昇段→未出場の残留）に正確に
  対応し、昇段後に新級出場すれば自然に消える。過去優勝の全履歴を見る必要はない。
- **④ StatsFilter に載せる:** `grades`（③ランキングのみ使用）・`includeFormerGrade` と同じ
  「使途限定フィールド」の前例に従い、choke point（`sanitizeStatsFilter`）の防御も同居させる。
- **④ プリセット式:** 自由入力より操作が速く、URL 直打ちの異常値はクランプで防御（ユーザー確定）。
