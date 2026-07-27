---
name: impl-entry-groups-task3
description: entry-groups タスク3完了(残5)
type: project
---

entry-groups（親Issue #359）**タスク3 完了**。commit 8cd2e8e（push 済み）。**タスク1-3 完了 / タスク4-8（#363-#367）残り。** 前提は [[impl-entry-groups-task1]] [[impl-entry-groups-task2]]。

## タスク3（#362）で入ったもの
`event_line_broadcasts` と `line_channels` の帰属を event → entry_group へ。招待コード発行・解除・延長・要綱選択/再送・手動再配信・自動解放がグループ単位になった（多摩 B/D/E のように従来未紐付けだった日にも連絡が届く）。

## ★migration 番号が計画からずれた（重要）
`drizzle-kit generate` は「同一テーブルで1列追加+1列削除」をリネーム候補と見なし対話プロンプトを要求 → 非TTY で必ず落ちる（[[drizzle-generate-rename-prompt]]）。回避のため**2パスに分けた**:
- `0046_busy_thunderball`（**手修正**: 新列 ADD → backfill → fail-loudly ガード3種 → NOT NULL → FK → UNIQUE）
- `0047_long_la_nuit`（自動生成のまま: 旧列 DROP）

→ **名簿（タスク8）も同じ2パスが必要で 0048 + 0049 になる見込み。** 0045/0046 は手修正版なので `db:generate` で上書きしないこと。手順書に実績表として記載済み。

## 実測検証（AC-7）
scratch DB `kagetra_migtest` に 0000〜0047 を順に適用し、多摩A/C に linked 紐付け＋Bot 予約＋revoked 履歴をシードして確認:
- 多摩A の紐付け（Gab）→ group 3 = 多摩A+多摩B ✓
- 多摩C の紐付け（Gcde）→ group 4 = 多摩C+D+E ✓
- revoked 履歴行も保全 ✓ / Bot 予約先も移行 ✓ / 旧列 0件 ✓

## ★引き継ぐべき設計判断
1. **公開 Server Action の引数は `eventId` のまま**。内部で `resolveEntryGroupId(dbc, eventId)` を通してグループへ解決する（UI は「その日」の id しか持たないため）。これで AC-4 が自然に出る
2. **行再利用セマンティクス厳守**（AC-5）: `findFirst`（entry_group_id）→ 既存なら**同一行 UPDATE**、無いときだけ INSERT。`entry_group_id` は UNIQUE なので INSERT を増やすと衝突する。`linked` 中の再発行はガードで弾く
3. **`broadcastApprovedUnits` の重複排除キーは `entryGroupId`**（旧: lineGroupId）。lineGroupId が違っても同一グループなら1回、を判別するテストあり
4. **`release-expired-broadcasts.ts` は相関サブクエリで「グループ内 MAX(event_date)+30日」**。events への単純 JOIN は複数日グループの1行を日数分に fan-out させ誤判定する（ワーカーが自力で気づいて回避）
5. **一般会員へ status のみスタブを渡す遮断は無変更**（要件 §6 の回帰契約）
6. **既知の制約**: 招待コードモーダルの「関連メール候補」（`loadGuidelineCandidates`）は依然イベント単位。グループの別の日から見ると候補一覧が食い違いうるが、選択・送信対象自体はグループ共通なので機能破綻はない。`docs/spec/notifications.md` に明記済み
7. **worktree のテスト DB が旧スキーマで残ると `drizzle-kit push --force` が非対話プロンプトで落ちる。** テスト DB を DROP して再作成させれば解消（テスト DB 限定操作）

## 検証（タスク3 時点）
Vitest **1852 passed / 1 skipped（135 files 全green）**・check-types **86件→0**・eslint clean・`git grep eventLineBroadcasts.eventId|assignedEventId` = 0件。
docs も更新済み（db.md / db-tables-events.md / db-tables-auth-line.md / spec/notifications.md）。

## 残り
Wave4=#363 タスク4（一括操作+通知集約+グループ日リンク）→ Wave5=**#364/#365/#366 並行可** → Wave6=#367 タスク8（名簿 + migration 0048/0049 + lottery 回帰）。**PR は1本。**
