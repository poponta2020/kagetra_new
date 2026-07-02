---
status: locked             # draft | iterating | locked
slug: player-search-redesign
target: apps/web/src/app/(app)/players/page.tsx（検索結果一覧）＋ components/PlayerSearchForm.tsx ＋ components/stats/section-tabs.tsx（タブ固定は統計4画面共通）
chosen_direction: A
round: 3
---
# 選手検索 結果一覧 デザイン仕様（design-spec）

> `/design-screen` の確定仕様。純UI＋データ拡張のため本 spec を要件成果物とし、実装は `/implement player-search-redesign` で行う（`/define-feature` の重複ヒアリングは回さない）。
> 確定はユーザー承認済み（DesignSync への最終 push は本人希望で省略）。確定モックのローカル実体＝`C:/tmp/design-screen/player-search-redesign/player-search-a.html`＋`_player-search.css`（Claude Design 上のカードは sticky 追加前の A 版）。

## 1. 対象と狙い
- **対象画面:** `/players` の検索結果一覧（[page.tsx](../../../apps/web/src/app/(app)/players/page.tsx#L48-L72)）。SectionTabs「選手検索」タブ配下。
- **現状の不満:** 結果が枠付きカードで重く、氏名＋「所属/都道府県」＋「N大会」だけ。同姓同名（区別しない方針）が並ぶと判別しづらく、現役か引退済みかも分からない。
- **狙い（ゴール）:** ①**現級**を見せる ②**最終出場大会の結果＋年月**を見せて「現役／引退の気配」を一目で分かるようにする ③従来の**出場大会数**は残す。同名の判別性も上げる。
- **主ユーザー / 主な使い方:** 全ログイン会員。選手名で検索して目的の人物を特定 → 戦績詳細へ。

## 2. 採用した方向性
- **方向性A（密なリスト・ランキング準拠 divide-y）を採用。**
  - 枠付きカードをやめ区切り線の密なリスト。50件でも一覧しやすい。
  - 各行に「氏名（級）＋所属会」「最終出場を1行集約」「出場大会数」を収め、視線移動を減らす。
- **不採用＝B案（構造化カード）:** 一時 B を選んだが A に確定。B は1件は読みやすいが縦に長くスクロール量が増えるため、多件一覧の主用途に A が勝る。B の実体は参考として残置（`player-search-b.html`）。
- **確定モック:** `preview/player-search-a.html`（共有CSS `preview/_player-search.css`）／`選手検索 結果一覧 (Redesign)` グループ。

## 3. レイアウト構成（上→下）
1. **MobileShell 上部バー**（かげとら／{名前}さん）— 既存不変・固定。
2. **SectionTabs**（選手検索/大会結果/ランキング/大会統計）— **スクロール時も上部固定**（§7・統計4画面共通）。
3. **検索バー**（検索アイコン＋入力＋「検索」ボタン）— **タブ直下に区画ごと固定**（§7）。
4. **結果件数ヘッダ**「「{query}」の検索結果 N 件（最終出場が新しい順）」。
5. **結果リスト**（下記の行）。

### 3.1 結果行（1件）の構成
`grid: [1fr | 出場大会数(auto) | ›(12px)]`、行タップで戦績詳細へ。
- **左（1fr）**
  - 1行目：**氏名**（Noto Serif JP 700 / 19px）＋直後に**現級 `(A)` 表記**（同じ serif で一体・級文字のみ括弧）＋その後ろに**所属会**（sans 11.5px meta）。すべて1行、氏名は省略記号。
  - 2行目：**最終出場**を1行集約（sans 10.5px muted）＝「最終出場：**YYYY/MM**（大会名 **結果**）」。年月は serif、大会名は省略記号、結果は入賞＝藍・記録なし＝砂ミュート。
- **右（auto）**：**出場大会数**。ラベル「出場大会数」（9.5px muted）＋数値（serif 16px）＋「大会」。
- **右端**：`›`（chevron・ink-muted）。

## 4. 使用コンポーネント
- **既存プリミティブ:** 検索フォームは既存 `PlayerSearchForm` を流用（見た目のみ washi 調整＝アイコン内包・角丸8px）。`SectionTabs`（[section-tabs.tsx](../../../apps/web/src/components/stats/section-tabs.tsx)）に sticky を付与。
- **級表記:** 従来の `GradePill`（info ピル）は**使わず**、氏名と同じ serif で `(A)` と一体表示（本画面の決定）。他画面の GradePill は不変。
- **新規:** 結果行コンポーネント（`.ps-rowA` 相当）を `players/components/` に切り出し。

## 5. 状態（state）
- **通常:** ヒット時に上記リスト（最大50件・現状 limit 踏襲）。
- **空（未入力）:** 現状文言「選手名を入力して検索してください。」を踏襲（washi 微調整のみ）。
- **該当なし:** 現状文言「「{query}」に一致する選手は見つかりませんでした。」を踏襲。
- **長大:** 50件上限のまま。密度は A で吸収。ページング/もっと見るは無し。
- **不明値:** 所属なし＝「所属不明」／最終出場の結果が導出不能・raw も無い＝「記録なし」（砂ミュート）／最終出場の開催日が無い＝年月の代わりに「開催日不明」（ミュート）。
- **引退の気配:** 最終出場年月が古い行は年月を**ミュート表示**（`.old`）。閾値は§9。

## 6. 必要データ（★searchPlayers 拡張＝要実装）
現状 `searchPlayers` の戻り＝`id / displayName / affiliation(直近大会の所属) / prefecture / participationCount`（[queries.ts](../../../apps/web/src/lib/players/queries.ts#L90-L126)）。以下を追加:

- **現級 `currentGrade`:** 最新参加（event_date 降順 NULLS LAST・同日は tournament id 降順）の非 null な `tournament_classes.grade`。詳細画面 `PlayerRecord.currentGrade` と同定義。相関サブクエリで1件。
- **最終出場 `lastEventDate`:** 直近参加の `tournaments.event_date`（null 可＝「開催日不明」）。所属サブクエリと同じ「直近1件」から。
- **最終出場大会名 `lastTournamentName`:** 同じ直近参加の `tournaments.name`。
- **最終出場の結果 `lastResult`:** 直近参加の順位。優先度：①対戦から導出できる級は bracket 由来（優勝/準優勝/ベストN）＝詳細画面 `rank`/`rankBracket` と同一ロジック（`derivePlacement`）②導出不能なら raw `final_rank`（例「3位」）③どちらも無ければ「記録なし」。
  - **導出コスト注意:** 導出は当該大会・当該級の全対戦が必要。結果は最大50件なので**各選手の直近参加1件（tournament,class）についてのみ**導出する。実装は「直近参加を1クエリで確定 → 対象 (tournament,class) の対戦をまとめて取得 → 導出」で N+1 回避。段階実装可（まず②③のみ→後段で①）。ただし詳細画面と表示が食い違わないよう導出は同一ロジックを使う。
- **並び順の変更（★）:** 現状の `participationCount 降順` → **`lastEventDate 降順（NULLS LAST）` 主キー**に変更（＝現役が上）。同日/同月のタイブレークは participationCount 降順 → displayName。件数ヘッダも「最終出場が新しい順」に更新。

## 7. インタラクション / レスポンシブ
- **行タップ:** `/players/{id}`（現状の遷移不変）。戻り導線は詳細側の既存 `?from=` に委ねる。
- **スクロール時ヘッダ固定（★2点）:**
  1. **SectionTabs 固定（統計4画面共通）:** 下スクロールでもタブが最上部に残る。**この画面に限らず**選手検索/大会結果/ランキング/大会統計の各メイン画面で共通の挙動＝`SectionTabs`（またはその配置レイアウト）側で `position: sticky; top:(shell上部バー下)` を実装。→ **共有変更のためスコープ注意（§9）**。
  2. **検索バー固定（選手検索のみ）:** タブ直下に**区画ごと**固定。ボタンだけが浮かないよう、検索ボックス＋ボタンを載せた区画に **surface 背景＋下境界（1px border）＋淡い影**を与えた「バー」を `position: sticky` にする。結果リストはこのバーの裏に潜って流れる。top はタブの高さ分オフセット。
- **モバイル:** 375px 基準。氏名・所属会・大会名はすべて省略記号で1行に収める。右列は `white-space:nowrap`。横スクロールは作らない。実装は Tailwind で（sticky/top 値・z-index の重なりに注意）。

## 8. ガードレール準拠メモ
- 氏名・現級・最終出場年月・出場大会数は **serif（Noto Serif JP）**。その他 meta は sans。
- **二値セマンティック:** 入賞（優勝/準優勝/ベストN）＝**藍**（正の強調）、記録なし／引退の気配（古い最終出場年）＝**砂ミュート**。朱は使わない（本画面に拒否/締切/エラーは無い）。級は虹色にせず serif の地色文字。
- 日付は一覧では `YYYY/MM`（詳細行は `YYYY/MM/DD` 可）。絵文字なし。固定バーの背景は washi（surface）で純白禁止。

## 9. 残課題・実装への申し送り
- **スコープ / PR構成（決定済み）:** 本 spec は2つの変更を含む。(a) **選手検索 結果一覧のリデザイン＋searchPlayers 拡張＋並び替え＋検索バー固定**、(b) **SectionTabs 固定（統計4画面共通の共有変更）**。**ユーザー決定＝1PR にまとめる**（2026-07-02）。ただしコミットは (b)共有→(a)画面 の順で分け、共有変更が先に単体で通ることを確認してから画面リデザインを重ねる（レビュー/回帰の切り分けのため）。他3画面（大会結果/ランキング/大会統計）の固定リグレッションも同PRで確認。
- **引退ミュートの閾値未確定:** 「最終出場が何年前からミュートか」（案：直近5年以内=通常／それ以前=ミュート、等）。モックは概ね10年目安。実装時に確定（もしくは年そのまま表示でミュートしない選択も可）。
- **級 `(A)` 表記:** ユーザー確定。将来「A級」表記へ戻す場合も serif 一体は維持。
- **固定バーの top オフセット:** タブ実測高さに依存。実装では計算値 or レイアウトで吸収（モックは top:44px 目安）。

## 10. 要件への宿題（→ /define-feature player-search-redesign）
> 収束ゲート＝この欄が空。データ拡張・並び替え・固定挙動はすべて §6/§7 に実装方針を書き切り、ユーザー承認済み。**宿題なし**（`/implement` へ直行可）。
- （なし）
