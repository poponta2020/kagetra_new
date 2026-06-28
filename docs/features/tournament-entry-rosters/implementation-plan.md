---
status: completed
---
# 大会ライフサイクル基盤（edition）＋申込・確定名簿 実装手順書

要件定義書: `docs/features/tournament-entry-rosters/requirements.md`
方針: 基盤先行（判断4=A）。各タスク＝1PR。テストファースト（API/ロジックテスト→実装→フロントテスト→実装→E2E）。`/do-plan` で worktree 隔離実行。

## 実装タスク

### タスク1【PR-1a 土台】series/editions の Drizzle化（baseline）＋ edition_id 列追加
- [x] 完了
- **概要:** 本番に raw 投入済みの `tournament_series` / `tournament_series_editions`（＋enum `tournament_kind`/`tournament_status`）を Drizzle スキーマに**現物一致**で定義。`events.edition_id`・`tournaments.edition_id`（本番は既存列）を追加。**挙動変更なしの純粋な土台**。
- **重要（baseline リスク）:** 本番には実物があるため migration は**冪等**にする（`CREATE TYPE/TABLE IF NOT EXISTS` 相当、`ADD COLUMN IF NOT EXISTS`）。fresh DB（test/dev）では新規作成され、本番では no-op。`db:migrate` 運用へ移行（`db:push` 禁止）。**`C:/tmp/prod_schema_series.sql` と差分ゼロ突合 → 本番 dump のコピーDBで dry-run** を必須ゲートにする。
- **変更対象ファイル:**
  - `packages/shared/src/schema/enums.ts` — `tournamentKindEnum`(tournament_kind), `tournamentStatusEnum`(tournament_status) 追加（既存名厳守）
  - `packages/shared/src/schema/tournament-series.ts`（新規）/ `tournament-series-editions.ts`（新規）— 現物列に一致（series: name unique/aliases text[]/kind/note、edition: series_id FK/edition_number/year/status/source_filetype/raw_name、UNIQUE(series_id, edition_number)）
  - `packages/shared/src/schema/events.ts` — `editionId`（FK→editions, ON DELETE SET NULL）追加
  - `packages/shared/src/schema/tournaments.ts` — `editionId` 追記（本番既存列に一致）
  - schema barrel（`packages/shared/src/schema/index.ts` 等）— export 追加
  - `apps/web/drizzle/`（migration）— 冪等 baseline migration
  - `apps/web/src/test-utils/db.ts` — truncate/setup に新表追加
- **依存タスク:** なし
- **テスト:** 型チェック green / コピーDB（本番相当 dump）で migration dry-run 成功・既存1236 editions と links 不変 / fresh test DB で新規作成される。
- **対応Issue:** #185

### タスク2【PR-1b 土台】event_group の撤去（判断2=B）
- [ ] 完了
- **概要:** 「同じ大会の束ね」は edition に一本化するため、`event_group` 一式を撤去。本番は空のためデータ損失なし。
- **変更対象ファイル:**
  - `packages/shared/src/schema/events.ts` — `eventGroupId` 列削除
  - `packages/shared/src/schema/event-groups.ts` — 削除
  - schema barrel — export 除去
  - `apps/api/src/routes/events.ts` / `apps/web/src/lib/form-schemas.ts` / `components/events/event-form.tsx` / `events/new` / `events/[id]/edit` / `events/[id]/page.tsx`（「大会グループ」表示）/ `admin/mail-inbox/actions.ts`（eventGroupId 分岐）/ `test-utils/seed.ts` / `test-utils/db.ts`
  - migration — `events.event_group_id` 列 drop ＋ `event_groups` テーブル drop
- **依存タスク:** タスク1（migration 順序）
- **テスト:** 既存テストから event_group 参照を除去し green / 型チェック green。
- **対応Issue:** #186

### タスク3【PR-2 flow①】edition 解決コア＋案内承認への組込み＋確認UI
- [ ] 完了
- **概要:** 大会名から系列を名寄せ（name＋aliases）し、開催（edition）を解決 or 新規作成（回次は「第N回」パース、無ければ最大＋1候補）するコアを実装。案内ドラフト承認（flow①）に組込み、生成 events に `edition_id` を設定。**名寄せは管理者確認必須**（曖昧/新規/回次不明）。
- **変更対象ファイル:**
  - `apps/web/src/lib/edition/resolve.ts`（新規, コア）＋テスト
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `approveDraft`/`approveDraftUnits` に edition 解決を組込み（FOR UPDATE で直列化、`UNIQUE(series_id, edition_number)`＋onConflict）
  - 確認UI（承認画面）— design-spec 待ち（§宿題）。最小は候補提示＋確定/新規作成。
- **依存タスク:** タスク1
- **テスト:** resolve コア単体（名寄せ/回次パース/新規採番/重複）→ approve 結合（edition 紐付け・冪等・並行）→ E2E（承認で edition 付与）。
- **対応Issue:** #187

### タスク4【PR-3 名簿】rosters/roster_entries ＋ ファイル取込
- [ ] 完了
- **概要:** 名簿2型（applicant/confirmed）テーブルを追加し、メール添付/アップロードのファイルをパースして取込。各行を `players`（姓名のみ同定・onConflictDoNothing）に解決、会員は `users` 紐付け。confirmed に出場状態を保持。
- **変更対象ファイル:**
  - `packages/shared/src/schema/tournament-entry-rosters.ts`（新規）/ `tournament-entry-roster-entries.ts`（新規）/ enums（`roster_type`,`roster_entry_status`）/ barrel / migration
  - `apps/web/src/lib/roster-import/`（新規, パーサ＋materialize。result-import の player 解決を再利用/共通化）＋テスト
  - 取込起動の Server Action（mail-inbox 添付 or アップロード）
- **依存タスク:** タスク1
- **テスト:** パーサ単体（applicant/confirmed・様式差）→ 取込 materialize（player/user 解決・冪等・(event_id,roster_type) 一意・再取込ポリシー）→ E2E。
- **対応Issue:** #188

### タスク5【PR-4 名簿UI】大会詳細の名簿表示＋会員突合
- [ ] 完了
- **概要:** 大会詳細で申込者/確定名簿を表示し、`roster_entries.user_id` 経由で自会員の掲載を突合ハイライト（判断3＝読み取り表示のみ・自動更新しない）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/[id]/page.tsx` ＋ 名簿表示コンポーネント（design-spec 待ち）
- **依存タスク:** タスク4
- **テスト:** 表示ロジック（突合・型/級別）→ E2E。
- **対応Issue:** #189

### タスク6【PR-5 flow②】結果取込への edition 解決組込み
- [ ] 完了
- **概要:** 結果ドラフト materialize 時に edition 解決コア（タスク3）を呼び、`tournaments.edition_id` を設定（自動サジェスト＋管理者確認）。
- **変更対象ファイル:**
  - `apps/web/src/lib/result-import/materialize.ts` — edition 解決を組込み
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（結果承認経路）＋確認UI
- **依存タスク:** タスク1, タスク3
- **テスト:** materialize 結合（edition 紐付け・冪等）→ E2E。
- **対応Issue:** #190

## 実装順序
1. タスク1（土台・依存なし）
2. タスク2（event_group 撤去・タスク1の後）
3. タスク3（flow① edition 解決・タスク1依存）
4. タスク4（名簿・タスク1依存）
5. タスク5（名簿UI・タスク4依存）
6. タスク6（flow② 結果側・タスク1,3依存）

## 注意
- 第4段（出場回数カウント）は本書スコープ外（土台のみ）。
- UI 3点（edition確認／名簿取込／名簿表示）は `/design-screen tournament-entry-rosters` の design-spec 確定後に実装精度を上げる。
- baseline（タスク1）は本番整合が最重要ゲート。dry-run 必須。
