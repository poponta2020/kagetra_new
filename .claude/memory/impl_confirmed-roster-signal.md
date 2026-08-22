---
name: impl-confirmed-roster-signal
description: 確定名簿シグナルの拡張 実装（タスク1・2）
type: project
---

確定名簿シグナルの拡張（親 Issue #509）をブランチ `feature/confirmed-roster-signal` で実装完了。worktree = `C:/tmp/impl-confirmed-roster-signal`。

## タスク1 (#510) — 判定を4材料へ拡張し共通関数へ寄せる（commit 683d413）

- `packages/shared/src/schema/entry-groups.ts` に `confirmedRosterOverride`（boolean NOT NULL DEFAULT false）を追加。migration `0058_lovely_calypso.sql`（ALTER TABLE 1行のみ・backfill 不要）。「意図的に列を持たない」doc コメントも同コミットで更新
- `apps/web/src/lib/events/confirmed-roster.ts`（新規・正典）= 純関数 `isConfirmedRosterSettled(signals)` ＋ ローダー `loadConfirmedRosterStates(groupIds)` / `loadConfirmedRosterState(groupId)`。返り値は `{ settled, override }`（トグルが別クエリを足さないため。要件 §6）。`import 'server-only'` 付き（vitest は alias stub で通る）
- 呼び出し側3画面を置換: `admin/entries/page.tsx` / `admin/entries/[groupId]/page.tsx` / `events/[id]/page.tsx`。`classify` / `buildEntryFlow` / `upcoming-entrants.ts` は無変更
- シグナル3のクエリは `mail_messages` INNER JOIN `events` ON `linked_event_id`（帰属が間接）

## タスク2 (#511) — 「確定名簿ありとして扱う」トグル（commit e274ef9）

- `events/[id]/actions.ts` に `setConfirmedRosterOverride(entryGroupId, value)`。`requireAdminSession()` → グループ実在確認 → UPDATE → `revalidateAfterLifecycleChange(全日のeventIds, groupId)`。★`listGroupSiblings` は eventId 起点で使えないため `select id from events where entry_group_id=?` で再検証対象を集める
- `RosterSection.tsx` に `adminControls?: RosterAdminControls`（値＋bind済み Server Action を1 prop に束ねる）。非管理者には `undefined`（PR #376 の教訓）

## 実装中に踏んだ落とし穴

- `mail_triage_status` enum は `unprocessed` / `processed` の**2値のみ**（`ignored` は無い）
- `buildEntryFlow` の現在地は「完了でも中立でもない最先頭」。`internalDeadline` が NULL だと会内締切が現在地になり、抽選/支払の検証に到達しない → フロー帯のテストは会内締切・申込締切を過去日にしてシードする
- 申込管理ボードは**空の区画見出しも常に描画する**。「区画が動かない」検証に `queryByRole('heading')` は使えず、区画内に当該カードが無いことで見る
- `docs/design/db.md` に `entry_groups` のテーブル定義が**存在しなかった**ので db-tables-events.md へ新設した

## 検証状況

`pnpm --filter=@kagetra/web test`（entries / events / lib 範囲）497件 green、`pnpm check-types` / `pnpm lint` 全パッケージ green。フルスイート・E2E は CI へ委譲。
