---
status: draft
---
# 大会申込（イベント一覧）改善 実装手順書

> 要件＝[`requirements.md`](./requirements.md)（completed）／視覚＝[`design-spec.md`](./design-spec.md)（locked, B案）。
> 対象は `/events` のみ。DB スキーマ変更・マイグレーションなし。テスト先行。

## 実装タスク

### タスク1: 純ヘルパー＋テスト（表示ロジックの核）
- [x] 完了
- **概要:** 一覧の表示/並び替えロジックを pure function 化し、まずテストを書いてから実装。`surname()` は詳細画面から共有 lib へ抽出。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/event-list-utils.ts`（新規）— 以下を実装:
    - `formatEventDate(eventDate)` → `M/D(曜)`（ゼロ埋めなし・曜日は JST 起点の決定的算出）。
    - `formatDeadlineCountdown(internalDeadline, todayStr)` → `{ text, tone: 'today'|'soon'|'normal'|'past'|'none' }`（当日=本日／1〜3日=soon／4日以上=normal／超過=締切済／null=`—`）。しきい値 3 は定数。
    - `isGradeEligible(eligibleGrades, grade)` → ⑦判定（対象級未設定=true／含む=true／grade=null かつ対象級ありは false）。
    - `sortEvents(list, axis)` → `'deadline'`＝internalDeadline 昇順・null 末尾・eventDate 副キー／`'date'`＝eventDate 昇順。
  - `apps/web/src/lib/surname.ts`（新規）— `surname(name)` を詳細画面のローカル関数から移設（挙動不変：空白/全角空白で分割し先頭、null は `?`）。
  - `apps/web/src/app/(app)/events/[id]/page.tsx` — ローカル `surname` を削除して新 lib を import（挙動不変）。
  - `apps/web/src/app/(app)/events/event-list-utils.test.ts`（新規）・`apps/web/src/lib/surname.test.ts`（新規）— 各分岐・境界（当日/±1/3↔4境界/null/未設定級/曜日/空白なし名）を網羅。
- **依存タスク:** なし
- **対応Issue:** #245（親 #248）

### タスク2: サーバー `page.tsx` 改修（データ取得＋見出し）
- [x] 完了
- **概要:** 一覧サーバーコンポーネントを「取得＋クライアント委譲」に整理。参加者名・自分の級・対象級を取り、カード用の最小データに畳む。見出しを「大会申込」に。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/page.tsx` —
    - 一覧取得に `eligibleGrades` を含める。ログイン中ユーザーの `grade` を取得。
    - `attend=true` 参加者を `users`（`name, grade`）結合で**表示中イベントぶん 1 クエリ**取得→イベント別に級昇順→`attendCount`（総数）＋`chipSurnames`（先頭5の `surname(name)`）を算出（現行の grouped count クエリを置換）。
    - 各イベントの `canApply = isGradeEligible(eligibleGrades, myGrade)` を算出。
    - `h1` を「大会申込」に変更（他の見出し行要素＝過去リンク/新規作成は据え置き）。
    - `{ id, title, eventDate, internalDeadline, status, canApply, attendCount, chipSurnames }[]` ＋ `todayStr` をクライアント一覧へ渡す。`location`/`official`/`grade`/`eligibleGrades` はカードへ渡さない。
- **依存タスク:** タスク1
- **対応Issue:** #246（親 #248）

### タスク3: クライアント一覧コンポーネント＋テスト（コントロール＋描画）
- [x] 完了
- **概要:** 並び替えセグメント＋申込可能スイッチ＋区切り線リスト（B案）を実装。締切 tone・参加者チップ・空表示を design-spec どおりに。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/EventListClient.tsx`（新規, `'use client'`）—
    - state: `sort: 'deadline'|'date'`（既定 `'deadline'`）、`applicableOnly: boolean`（既定 `false`）。
    - 「フィルタ（canApply）→ ソート（sortEvents）」して区切り線リストで描画。行タップ→`/events/[id]`。
    - 開催日＝`formatEventDate`、締切＝`formatDeadlineCountdown`（tone→クラス）、status→`StatusPill`、参加者＝「参加 N名」＋苗字チップ最大5＋「他N名」。
    - 空表示：フィルタ ON で 0 件＝「申込可能な大会はありません」／全体 0 件＝現状文言。
  - `apps/web/src/app/(app)/events/EventListClient.test.tsx`（新規）— ソート切替の並び順、申込可能フィルタの絞り込み、締切 tone 出し分け（本日/soon/normal/締切済/—）、チップ「他N名」、中止行、空表示 を検証。
- **依存タスク:** タスク1・タスク2
- **対応Issue:** #247（親 #248）

## 実装順序
1. タスク1（依存なし・テスト先行の核）
2. タスク2（タスク1に依存）
3. タスク3（タスク1・2に依存）

## メモ
- DB/API/マイグレーション変更なし。参加「数」の集計セマンティクス（`attend=true`）は不変。
- `Date.now()` を描画で呼ばない（`todayStr` を prop 伝播）＝hydration mismatch 回避。
- ヘルパーの int[] バインド等の DB 落とし穴は本 PR では非該当（生 SQL の配列バインドを使わない）。
