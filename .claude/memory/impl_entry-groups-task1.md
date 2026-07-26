---
name: impl-entry-groups-task1
description: entry-groups タスク1完了(残7)
type: project
---

entry-groups（親Issue #359・全8タスク）の**タスク1 のみ完了**。worktree=`C:/tmp/impl-entry-groups`・ブランチ `feature/entry-groups`・commit 89a888f（push 済み）。**残 7 タスク（#361〜#367）は未着手。**

## 完了したこと（タスク1 / #360）
`entry_groups` テーブル + `events.entry_group_id` NOT NULL + migration 0045 + events INSERT 全経路のシングルトン化 + テスト基盤の対応。この時点で**既存挙動は不変**。

## ★次セッションが最初に読むべき注意点

### 1. migration 0045 は手修正版。再生成で上書きしないこと
drizzle-kit generate は `ADD COLUMN ... NOT NULL`（default 無し）を出し既存行で失敗する。
nullable ADD → plpgsql backfill → fail-loudly ガード → SET NOT NULL → FK/index の順へ手で書き換えてある。

### 2. vitest では migration が走らない（AC-2 検証の前提）
global-setup が `drizzle-kit push --force` で**最終スキーマを直接 push する**ため、
migration ファイルの backfill SQL はテストスイートで一度も実行されない。
→ 0046/0047 でも同じ。**scratch DB へ順に適用して実測する**のが唯一の検証手段。
今回使った手順（再利用可能）:
```
docker exec kagetra-db-test psql -U kagetra -d postgres -c 'CREATE DATABASE kagetra_migtest;'
cd packages/shared/drizzle && for f in $(ls [0-9][0-9][0-9][0-9]_*.sql | sort | sed -n '1,45p'); do docker exec -i kagetra-db-test psql -U kagetra -d kagetra_migtest -v ON_ERROR_STOP=1 -q < "$f"; done
```
（scratch DB `kagetra_migtest` は 0045 適用済みの状態で残してある。0046 の検証にそのまま使える）

### 3. クラスタ規則の正は純関数 `clusterEventsByEntryGroup`（`apps/web/src/lib/entry-groups.ts`）
同 draft × 同申込締切（**null 同士も一致**）→ 同一グループ／draft 無しはシングルトン。
migration の plpgsql と タスク7 の承認フォーム提案は**この関数と同じ結果**にすること。
SQL 側の意味論は `entry-groups.sql.test.ts` が実 DB で固定している。

### 4. テストの events INSERT は choke point 化済み
`createEvent()` が既定でシングルトングループを自動生成するので、グループを意識しないテストは無改修。
同一グループの複数日を作るテストだけ `createEvent({ entryGroupId })` を使う（`createEntryGroup()` で id を取る）。
`truncateAll` に `entry_groups` を明示列挙済み（events → entry_groups は RESTRICT なので CASCADE では消えない）。

### 5. ★実装手順書のタスク8 は着手前に訂正済み（PR #376 の影響）
event-detail-redesign 出荷で `uploadRoster` / `RosterUploadForm` が**削除済み**。
タスク8 の変更対象から外し、AC-17 の「アップロード」はメール取込経由のみと読み替える。
また page.tsx の名簿クエリには `columns` 列制限が入っている（client component への
RSC payload 漏洩対策）。**グループ基準へ書き換える際に落とさないこと**。

## 検証（タスク1 時点）
- Vitest **1787 passed / 1 skipped**（既存 1776 + 新規 12、既存は全て green＝挙動不変）
- check-types clean・eslint clean
- **scratch DB で 0045 を実データ形状に適用して実測**: 多摩5件→2グループ・秋田2件→2グループ・
  締切NULL2件→1グループ・draft無し2件→各シングルトン・取りこぼし0件（計7グループ）

## 残タスクと依存（plan の Wave）
Wave2=#361 タスク2（core lib + 編集フォーム + 締切伝播）→ Wave3=#362 タスク3（LINE + migration 0046）
→ Wave4=#363 タスク4（一括操作 + 通知集約）→ Wave5=**#364/#365/#366 は並行可**
→ Wave6=#367 タスク8（名簿 + migration 0047 + lottery 回帰）。
**PR は1本**（0046 適用済み・0047 未適用の状態を本番に置かないため）。
