---
status: completed
completed_sections: [ユーザーストーリー, 機能要件, 技術設計, 影響範囲]
next_section: null
design_required: false
---
# senseki-ranking-drilldown 要件定義書

> 統計タブ・ランキング（[[impl_senseki_stats_pr3_ranking]] PR#222・[[project_senseki_ranking_refinements_def]] PR#230）
> から選手詳細（/players/[id]・[[project_senseki_detail_redesign]]）への**ドリルダウン絞り込み**。
> ランキングの選手名タップで遷移した詳細画面に、遷移元のフィルタ（期間・級）を適用する。
> 既存画面への delta 改修（新画面なし・DB 変更なし・migration なし）。design_required: false（ユーザー確認済み）。

## 1. 概要

- **目的:** ランキングに出た数字（出場23回・優勝5回など）の**内訳**をワンタップで見られるようにする。
  現状はランキングから選手詳細へ遷移すると全成績（通算）が表示され、ランキングの数字と画面の数字が
  対応しない。
- **改修内容:**
  - **① 全指標共通:** ランキング（出場・勝利・勝率・対戦・優勝・入賞）から選手名タップで遷移した
    選手詳細を、**遷移元ランキングの期間＋級フィルタ**で絞って表示する
    （例: 2021–2026・A級 → その選手が 2021〜2026 年に出た A級大会の結果のみ）。
  - **② 優勝・入賞のみ追加:** ①に加えて、大会結果の一覧を**実際に優勝（bracket=1）／入賞
    （ベスト8以上）した大会のみ**に絞る。
  - ヘッダ集計値は①の条件で再計算し、**導出条件を明記**する（「2021〜2026年・A級大会での成績」）。
  - UI 構成は選手検索から遷移した詳細画面と同一（絞り込み表示1行の追加のみ）。

## 2. ユーザーストーリー

- 対象ユーザー: 全ログイン会員（統計タブの閲覧者）。
- ユーザーの目的: ランキングで気になった選手・数字について「その数字はどの大会で作られたのか」を
  すぐ確認したい。
- 利用シナリオ:
  - A級・直近5年の優勝回数ランキングで「優勝5回」の選手をタップ → その5大会（優勝した大会）が
    並んだ詳細が開き、各大会の試合表まで確認できる。
  - 2021–2026・B級の出場回数ランキングで選手をタップ → その期間の B級出場大会だけが時系列で並ぶ。
  - 全成績も見たければ「絞り込みを解除」でその場で切り替えられる。

## 3. 機能要件

### 3.1 発火条件（いつ絞り込むか）

- 選手詳細 `/players/[id]` が **`?from=ranking`** で開かれ、かつ解除フラグ（後述 `all=1`）が
  無いとき**のみ**絞り込みを適用する。
- 適用するフィルタは URL に複写済みのランキング params（`metric` / `f` / `yearFrom` / `yearTo` /
  `grades`。PR#230 ④で全タップ URL に付与済み）から復元する。
  - **非明示（`f` 無し＝ランキングのデフォルトビュー）** → ランキング側と同じデフォルト
    **級A・直近5年（当年−5〜当年）** を詳細側でも注入する（`parseRankingParams` を再利用）。
    ランキングに表示されていた数字と厳密に同じ母集合になる。
  - **明示（`f=1`）** → URL の値そのまま（grades 無し＝全級・years 無し＝全期間）。
- `from` が無い・数値（相手名タップ由来）・その他 → 従来どおり全成績表示（挙動不変）。
- `includeFormer`（⑤昇段者トグル）と将来の `minMatches`（senseki-stats-refinements ④）は
  「ランキングに誰を載せるか」のパラメータであり、個人の大会絞り込みには**使わない**（無視）。

### 3.2 ① 期間＋級の絞り込み（全6指標共通）

- 大会結果（participations）を以下で絞る。**条件式のセマンティクスはランキング集計
  （`ranking.ts` の `filterConds`）と同一**にする:
  - 期間: `tournaments.event_date` が `yearFrom-01-01`〜`yearTo-12-31`。期間指定時、
    event_date 無しの大会は除外（ランキングでも数えられていない）。
  - 級: `tournament_classes.grade IN (選択級)`。級指定時、grade 不明（null）の参加は除外
    （同上）。
- タイムライン（年グルーピング・折り畳み・試合表）は絞り込み後の集合で従来どおり描画する。

### 3.3 ② 優勝・入賞の追加絞り込み（一覧のみ）

- `metric=championships` → ①の絞り込みに加えて **`derived_bracket = 1`** の参加のみ一覧に表示。
- `metric=nyusho` → 同じく **`derived_bracket <= 8`**（ベスト8以上）のみ。
- 判定はランキングと**単一定義**（事前計算列 `derived_bracket`。PR#220 で表示順位
  `rankBracket` との一致が SSOT テスト済み）。
  - 既知の割り切り: 順位導出不能級（リーグ等）で `final_rank` テキストにより「優勝」と表示される
    参加は、ランキングの優勝回数にも数えられておらず、②の一覧にも出ない（数字と一覧が常に一致）。
- ②の**ヘッダ集計は①（期間＋級）ベース**のまま（優勝した大会だけで勝率を計算するような不自然さを
  避ける）。一覧だけがさらに絞られることを条件表示行で明示する（3.4）。

### 3.4 ヘッダ集計の再計算と導出条件の明記

- 絞り込み適用時、ヘッダの集計値（通算◯勝◯敗・勝率・◯大会・優勝 N・入賞 N・活動年スパン）を
  **①の期間＋級で再計算**する。
  - **受け入れ基準: ランキングに表示されていた指標値とヘッダの対応値が一致する**
    （出場↔◯大会、勝利↔◯勝、勝率↔勝率、対戦↔勝＋敗、優勝↔優勝 N、入賞↔入賞 N）。
- **導出条件の表示行**を追加する（ユーザー確定）。表示例（文言・体裁は実装時調整）:
  - ①: 「**2021〜2026年・A級大会での成績**」。全期間なら「全期間・A級大会での成績」、
    全級なら「2021〜2026年・全級での成績」。複数級は「B・C級」。
  - ②: ①の表記に「**（優勝した大会のみ表示）**」「（入賞した大会のみ表示）」を付す。
- **アイデンティティ情報は全成績ベースを維持**: 氏名・現級（氏名横の「（A級）」）・ヘッダ所属
  （直近大会の所属）は絞り込みの影響を受けない（B級で絞ったら現A級の人が「（B級）」になる、を防ぐ）。

### 3.5 絞り込みの解除導線

- 条件表示行に「**絞り込みを解除して全成績を見る**」リンクを置く（ユーザー確定）。
- 解除リンク先は**現 URL に `all=1` を追加**したもの（`from=ranking`＋ランキング params は維持）。
  - 解除後は従来の全成績表示（条件表示行なし）。
  - 「← ランキングへ戻る」導線（BackButton の href 再構成・router.back）は解除後も維持される。
  - 絞り込み表示に戻るのはブラウザ戻るで可能（履歴に残る）。

### 3.6 エラーケース・境界条件

- 絞り込み結果が 0 件（直 URL・データ変化時のみ。ランキング経由では HAVING>0 のため通常起きない）
  → 「絞り込み条件に該当する大会がありません」＋解除導線を表示（選手が存在する限り 404 にしない）。
- 選手が存在しない → 従来どおり notFound。
- 不正な params（範囲外の年・不明な級・不明な metric）→ 既存の `sanitizeStatsFilter` /
  `coerceRankingMetric` の丸めに従う（ランキング側と同じ防御）。

### 3.7 変えないこと

- タイムライン UI（年折り畳み・初期全閉・試合表・順位表示・rankEmphasis）は不変。
- 相手名タップ → 相手の詳細は**フィルタを引き継がない**（従来どおり全成績・`?from={playerId}`。
  ユーザー確定）。ブラウザ戻るで絞り込み画面に復帰する。
- 選手検索（/players）からの遷移・検索結果画面は不変（絞り込みなし）。
- ランキング画面そのもの・タップ URL の組み立て（`buildPlayerHrefFromRanking`）は不変。
- DB スキーマ・ランキング集計・選手検索クエリは不変。

## 4. 技術設計

### 4.1 URL・パラメータ設計

- **新規パラメータの発明はしない。** PR#230 ④で選手詳細 URL に複写済みのランキング params
  （`from=ranking&metric=…&f=1&yearFrom=…&yearTo=…&grades=…`）をそのまま絞り込みに使う。
  過去に共有された URL も自動的に新挙動になる。
- 追加は解除フラグ **`all=1`** のみ（絞り込み無効化・その他 params 維持）。
- parse は既存 `parseRankingParams(sp, currentYear)` を再利用（page.tsx が戻る href 再構成で
  既に呼んでいるものと同一呼び出しに統合）。

### 4.2 データ取得（`lib/players/queries.ts`）

- `getPlayerRecord(playerId)` にオプション第2引数を追加:
  ```ts
  getPlayerRecord(playerId, opts?: {
    filter?: StatsFilter          // yearFrom / yearTo / grades のみ使用
    bracketAtMost?: 1 | 8         // ②: championships=1, nyusho=8, ①=undefined
  })
  ```
- 実装方針（最小 diff）: 現行の relational query（`findMany` + `with`）は親の横断条件を書きにくい
  ため、**フィルタ指定時のみ**対象 participant id を先に軽量 join クエリ
  （tp → tc → t、期間・級・`derived_bracket` 条件）で絞り、既存 `findMany` に
  `inArray(tournamentParticipants.id, ids)` を追加する。フィルタ無しは現行パスのまま（挙動不変）。
  - ②の `bracketAtMost` は**一覧（participations）の id 絞りにのみ**適用。
  - ヘッダ集計用に、①（期間＋級のみ・bracket 条件なし）の集合で championships / nyusho /
    tournamentCount / activeYears / 勝敗 agg を計算する（②でも一覧と集計の母集合を分ける）。
  - 勝敗 agg（totalWins/totalLosses）はフィルタ時、①で絞った participant ids に対する
    matches 集計に変更（既存クエリに `inArray` 追加）。
- **アイデンティティの分離:** 現級・ヘッダ所属はフィルタ時も全成績ベースで表示するため、
  フィルタ指定時のみ軽量クエリ（最新参加の非 null grade / 直近参加の affiliation。
  `searchPlayers` の相関サブクエリと同型）で別取得する。フィルタ無しは現行導出のまま。
- 条件セマンティクスの一致は `ranking.ts` の `filterConds` と同形の式で担保
  （export して共用するか queries 側に同形実装＋一致テスト。実装時にシンプルな方を採用）。

### 4.3 ページ・表示（`app/(app)/players/[id]/`）

- `page.tsx`:
  - `fromRaw === 'ranking'` かつ `all !== '1'` のとき `parseRankingParams` の結果から
    `{ filter, bracketAtMost }` を組んで `getPlayerRecord` へ渡す（`metric` → bracket 変換:
    championships→1・nyusho→8・他→undefined）。
  - 条件表示行＋解除リンクをサマリー部に追加（既存の注記トーン `text-ink-meta` 系・1〜2行。
    新コンポーネント不要ならインライン、テスト都合で小コンポーネント化も可）。
  - 0 件時の空状態文言を絞り込み時のみ差し替え（「絞り込み条件に該当する大会がありません」＋解除
    リンク。従来の「出場記録がありません。」は非絞り込み時のまま）。
- **条件表示行の文言生成は純関数**として切り出す（例: `[id]/scopeLabel.ts` の
  `formatRankingScopeLabel(metric, filter)`）→ 単体テスト容易・page は表示だけ。
- 解除 href の生成も同所で純関数化（現 searchParams 複製＋`all=1`）。
- `SensekiTimeline` / `BackButton` / `RankingList`（ランキング側）は変更なし。

### 4.4 テスト

- `lib/players/queries.test.ts`（DB-backed・主戦場）:
  - 期間のみ / 級のみ / 期間＋級で participations が正しく絞られる（境界: 年初・年末の日付、
    event_date null 除外、grade null 除外）。
  - ② `bracketAtMost=1 / 8` で一覧が優勝/入賞参加のみになる。ヘッダ集計（championships 等）は
    ①母集合で計算される（一覧より大きい値になり得る）。
  - ヘッダ再計算値がランキング集計（`getPlayerRanking`）の同条件の値と一致する（受け入れ基準の
    整合テスト）。
  - アイデンティティ（currentGrade・ヘッダ所属）はフィルタに影響されない。
  - フィルタ 0 件で participations 空・record 非 null。
  - フィルタ無し呼び出しの回帰（現行スナップショットと同値）。
- `scopeLabel` 純関数の単体テスト（①/②・全期間・全級・複数級・単年の文言）。
- 既存テストの回帰（`SensekiTimeline.test.tsx` 等は非変更のまま green）。

## 5. 影響範囲

- 変更ファイル:
  - `apps/web/src/lib/players/queries.ts` — `getPlayerRecord` 拡張（＋test）
  - `apps/web/src/app/(app)/players/[id]/page.tsx` — 発火判定・条件表示行・解除導線・空状態
  - `apps/web/src/app/(app)/players/[id]/scopeLabel.ts`（新規・純関数＋test）
  - （必要なら）`apps/web/src/lib/stats/ranking.ts` — `filterConds` の export 化のみ（挙動不変）
- **DB 変更なし・migration なし。** ランキング画面・選手検索・大会統計・大会結果タブは不変。
- **並行作業の注意:** senseki-stats-refinements（定義済み・実装待ち）が `ranking.ts` /
  `metrics.ts` / `RankingFilterBar.tsx` を変更予定。本機能は `metrics.ts` を参照（再利用）中心・
  `ranking.ts` は触っても export 追加のみだが、**同時実装は避け直列に**（どちらが先でも可。
  refinements ④の `minMatches` param は本機能では無視するので機能的干渉なし）。
- 既存 URL 互換: ランキング由来の既存 URL は自動的に絞り込み表示になる（これが本機能の意図）。
  それ以外の URL・遷移は挙動不変。

## 6. 設計判断の根拠

- **URL は PR#230 の複写資産を流用:** 選手名タップ URL には既にフィルタ一式が載っている。
  新パラメータを増やさず、詳細側が「読むだけ」で完結。組み立て側の変更ゼロ。
- **非明示時は詳細側でも同じデフォルト注入:** ランキングの画面に出ていた数字（デフォルト＝A級・
  直近5年）と詳細の母集合を厳密一致させるため。`parseRankingParams` 再利用で定義も単一。
- **② は `derived_bracket` で判定:** 優勝/入賞回数ランキングと単一定義（[[impl_senseki_stats_pr1_derived_bracket]]）。
  `final_rank` テキスト解釈を持ち込むと「ランキング5回なのに一覧6件」の不整合が起きる。
- **②のヘッダは①ベース:** 優勝大会だけを母集合に勝率などを出すのは意味を成さないため
  （ユーザー確定・Q1）。一覧との差は条件表示行で説明する。
- **ヘッダ再計算＋導出条件の明記:** ランキングの数字と画面の数字が一致することがドリルダウンの
  価値（ユーザー確定・「2021年〜2023年のB級大会での成績」形式の明記要望）。
- **解除は `all=1` で params 維持:** 素の `/players/{id}` へ飛ばすと「← ランキングへ戻る」導線が
  消える。複写 params を保持したまま絞り込みだけ無効化する。
- **相手遷移は引き継がない:** 相手を見る目的にはその選手の全体像が自然（ユーザー確定・Q3）。
- **identity は全成績ベース:** 現級・所属は「その人が誰か」の情報であり、絞り込み条件で
  変わってはならない（B級絞りで現A級者が B級表示になる誤りを防ぐ）。
