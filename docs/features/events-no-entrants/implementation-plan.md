---
status: completed
---
# events-no-entrants 実装手順書

要件: [requirements.md](requirements.md)（AC は §4）

## 技術設計の要点

- **新ページ**: `apps/web/src/app/(app)/events-no-entrants/page.tsx`（RSC・`/events-archive` と同型）。
  - SQL 側で粗く絞る: `eventDate >= todayStr` AND `internal_deadline IS NOT NULL` AND `internal_deadline < todayStr` AND `entry_status <> 'not_applying'`、`ORDER BY event_date ASC, id ASC`。
  - 取得後に `isPastDeadline`（`../events/event-list-utils`）で確定させる — 締切超過判定の唯一の真実を二重定義しない。`event-list-utils.ts` は `'use client'` を持たない純関数モジュールなので RSC から import できる（移動しない）。
  - 参加者 0 名の判定: 候補 ID にスコープした `attend=true` の集計 1 クエリを取り、**集計結果に現れない ID** を 0 名とする（N+1 なし）。
  - カード右側は `参加 n名` ではなく `会内締切 {formatFlowDate(internalDeadline)}`（`@/lib/event-date`）。
- **ゲート**: `isGuestAllowedPath` は許可リスト方式で `default: false` のため、**追加しないこと自体が仕様**（middleware が `/403` へ飛ばす）。回帰テストで固定する。
- **`/events` の導線**: フッターを 2 段（`flex flex-col gap-2`）にし、1 段目は現行（過去の大会 → / 新規作成）、2 段目に「申込者なしで締切済 →」。ゲスト（`isGuestRole(session?.user.role)`）には 2 段目を描画しない。
- **`/events` 本体のクエリ・`isRowVisible`・`/events-archive` の掲載条件は変更しない。**

## 実装タスク

### タスク1: 「イベント」→「大会」文言統一
- [x] 完了
- **目的:** ボトムナビのタブ名と一覧まわりの見出し・空状態文言を「大会」に揃える（requirements §3.4）
- **対応AC:** AC-1, AC-2, AC-3, AC-15, AC-16, AC-17（回帰）, AC-18（回帰）
- **主な変更領域:**
  - `apps/web/src/components/layout/bottom-nav.tsx`（`TABS` の `label`・関連コメント）
  - `apps/web/src/components/layout/bottom-nav.test.tsx`（「イベント」を含む 18 箇所。タブ順・href・active・guest-role の各テスト）
  - `apps/web/src/app/(app)/events-archive/page.tsx`（h1「過去の大会」／戻りリンク「現在の大会 →」／0 件文言）
  - `apps/web/src/app/(app)/events/page.tsx`（フッターの archive リンク文言のみ。導線追加はタスク3）
  - `apps/web/src/app/(app)/events/EventListClient.tsx`（0 件文言「現在の大会はありません」）
  - `apps/web/src/app/(app)/events/page.test.tsx`・`EventListClient.test.tsx`（文言アサートの追随）
  - `apps/web/CLAUDE.md`（ルート構成の説明文）
- **依存タスク:** なし
- **必要なテスト:** 既存の bottom-nav テストを「大会」へ改訂（タブ順・href・active・ゲスト2タブ）。`/events-archive` の見出し・戻りリンク・0 件文言のアサートを追加（既存の archive describe に足す）。AC-18: 開催日が過ぎた大会が参加者 0 名でも `not_applying` でも archive に出る既存回帰（`page.test.tsx` の archive describe）を維持する。`isRowVisible` の回帰テスト（既存）もそのまま green を維持。
- **完了条件:** `pnpm --filter web test` の対象ファイル群が green・typecheck 通過。ユーザー向け文言に「イベント」が残るのは Non-goals の箇所（作成/編集画面・メール承認）だけ。
- **対応Issue:** #506

### タスク2: `/events-no-entrants` ページ新設
- [x] 完了
- **目的:** 会内締切超過・申込者 0 名・開催日前の大会だけを開催日昇順で並べるページを作る（requirements §3.2 / §3.3）
- **対応AC:** AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-14, AC-19, AC-22
- **主な変更領域:**
  - `apps/web/src/app/(app)/events-no-entrants/page.tsx`（新規）
  - `apps/web/src/app/(app)/events-no-entrants/page.test.tsx`（新規）
  - `apps/web/src/app/(app)/page-padding.test.ts`（`TARGET_PAGES` に `events-no-entrants/page.tsx` を追加）
  - `apps/web/src/lib/guest-access.test.ts`（`isGuestAllowedPath('/events-no-entrants') === false` の回帰。**`guest-access.ts` 本体は変更しない**）
- **依存タスク:** なし（`/events` 側のファイルには触らない）
- **必要なテスト:** 実 test DB ＋ RSC 直呼びで、`/events` の既存テストと同じ形（`createEvent` / `createEventAttendance` / `setAuthSession`）。掲載: 締切超過×0名／**全員が `attend: false` で回答した大会（AC-22）**。⚠️ `createEventAttendance` は `attend` の既定が `true` なので、不参加ケースは `attend: false` を明示して seed する。非掲載: 締切 NULL・締切当日・締切未来・参加 1 名以上・`not_applying`・開催日が過去。並びが開催日昇順。0 件文言。カードの href と「会内締切 M/D」表示。
- **完了条件:** 新規テストが green・typecheck 通過・`page-padding` テスト green。
- **対応Issue:** #507

### タスク3: `/events` から新ページへの導線
- [ ] 完了
- **目的:** `/events` フッターに「申込者なしで締切済 →」を追加し、ゲストには出さない（requirements §3.1 / §3.5）
- **対応AC:** AC-12, AC-13
- **主な変更領域:**
  - `apps/web/src/app/(app)/events/page.tsx`（フッターを 2 段化＋`isGuestRole` 判定を追加）
  - `apps/web/src/app/(app)/events/page.test.tsx`（導線のテストを追加）
- **依存タスク:** タスク1（同じ `events/page.tsx` の文言を先に変える）、タスク2（リンク先ページの存在＝型付きルートの解決）
- **必要なテスト:** 会員/管理者で「申込者なしで締切済 →」が `/events-no-entrants` を指すこと。ゲストではそのリンクが無く「過去の大会 →」はあること。（`/events` の可視性そのものは AC-17 の既存回帰が担保するので、ここでは追加しない。）
- **完了条件:** `/events` のテストが green・typecheck 通過。
- **対応Issue:** #508

## 実装順序（Wave = 並行実装できるタスクの組）
- Wave 1: タスク1, タスク2（変更領域が重ならない。タスク2 は `events/` 配下を触らない）
- Wave 2: タスク3（タスク1・2 に依存）
