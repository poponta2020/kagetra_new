---
name: impl-event-list-redesign
description: event-list-redesign 実装
type: project
---

# event-list-redesign 実装（/events 大会申込一覧の再リデザイン）

worktree: `C:/tmp/impl-event-list-redesign`（ブランチ `feature/event-list-redesign`）
親Issue #340・子Issue #341〜#344。要件=docs/features/event-list-redesign/requirements.md、視覚の正=design-spec.md（locked）+ design-mock/redesign.html（`design_source: claude-design` ＝ patch なし・移植が必要）。

## Wave 構成
- Wave 1: タスク1（main 直実装。型と純関数＝共有ホットスポットなので単独先行）
- Wave 2: タスク2（page.tsx）+ タスク3（EventListClient.tsx）を task-implementer 2体で並行
- Wave 3: タスク4（main）

## タスク1 完了（commit d2e4bc6・Issue #341）
`apps/web/src/app/(app)/events/event-list-utils.ts` + `.test.ts`
- `EventListItem`: `chipSurnames` → `attendeeSurnames`（全員分）、`viewerAttending: boolean` 追加、`CHIP_LIMIT` 削除
- `formatDeadlineCountdown` の戻り値に `daysLeft: number | null` を追加（数字だけ拡大表示するため）。既存 `toEqual` 8件を更新
- `isPastDeadline` = `formatDeadlineCountdown(...).tone === 'past'` を単一の真実に（しきい値を二重化しない）
- `isRowVisible` = `!isPastDeadline || viewerAttending`／`isOpenForEntry` = `canApply && !cancelled && !pastDeadline`（帯の藍/砂）
- テスト40件 green

**注意点**: このコミット単体では `pnpm check-types` は通らない（page.tsx / EventListClient.tsx が旧フィールド名を参照中）。タスク2・3 で解消するまで typecheck の赤はバグではない。

## Advisor が拾った設計の穴（要件・AC がカバーしていなかった）
可視フィルタ（`isRowVisible`）で**全行が隠れた場合**、素直に実装すると `items.length === 0` の早期リターンをすり抜けて「申込可能な大会はありません」（＝フィルタ0件の文言）がスイッチ OFF のまま出る。会のオフシーズンでは普通に起きる状態。
→ **空表示の母集団は「可視フィルタ適用後」**とし、`visible.length === 0` で「現在のイベントはありません」（コントロール非表示）を出す方針で確定。AC-13 の「フィルタ0件時」という文言がスイッチ ON 前提であることが決め手。

## モックの `#fff` の解釈（ドリフトではない）
`redesign.html` の `.ddl.today .val{color:#fff}` は `text-white` ではなく **`text-ink-on-brand`** で実装する。同じモックの `.seg .tab.active{color:#fff}` が出荷済み実装では `text-ink-on-brand` になっており、モックの `#fff` は「on-brand の白」の略記だと確定できるため。純白の例外を増やさない。

## Wave 2 完了（task-implementer 2体並行・排他宣言のミスなし）
- タスク2 #342 = commit aeb4900（`page.tsx` / `page.test.tsx`）。`participantRows` の select に `userId` を足すだけで `viewerAttending` を判定（追加クエリなし）。`userId` は items に含めずサーバー内で消費。ルート div に `p-4`
- タスク3 #343 = commit 1be76cb（`EventListClient.tsx` / `.test.tsx` / `docs/spec/events-attendance.md`）。色帯・上段順入替え・締切の数字拡大・参加者刷新をモック class 対応で移植
- 変更領域の重複ゼロ。統合後の diff にも矛盾なし

### main が受け入れ時に直した2点（ワーカー起因の取りこぼし）
1. `page.test.tsx` の `toMatch(/参加\s*7\s*名/)` — 新デザインは「参加」の語を廃止し人数＋「名」だけなので矛盾。`toContain('7名')` へ
2. `EventListClient.test.tsx` の色帯テストで fixture タイトルを `'中止'` にしていたため `getByText('中止')` が**中止ピルのラベルと二重ヒット**して fail。タイトルを `'中止イベント'` へ。**ステータスピルのラベルと同じ文字列をタイトルに使わない**

## タスク4 #344 = commit 7a1e082
`mobile-shell.test.tsx` に「`<main>` が padding utility を持たない」assertion（`not.toMatch(/\bp[xytrbl]?-/)`）。余白はページ側で完結させる境界を機械的に固定（AC-14）。

## 検証結果（2026-07-26）
- `pnpm --filter=@kagetra/web test --no-file-parallelism`: **119 files / 1616 passed / 1 skipped**
- `pnpm check-types` / `pnpm lint`: 全パッケージ green
- 忠実度チェックリスト10項目: コード照合で全項目クリア。375px の実画面確認は**未実施**（worktree から dev サーバーを起動すると worktree 削除が Device busy になるため）→ 出荷後に本番で確認

## 実装で効いた細部
- `rounded-[2px]` は生値を使う。プロジェクトの `rounded-sm` は **5px** でモックの 2px と違う（トークンに寄せると劣化する例）
- 締切の数字だけ拡大するため `formatDeadlineCountdown` に `daysLeft` を足し、UI 側で `あと<em>{daysLeft}</em>日` と分割描画する。この結果 **`getByText('あと5日')` は落ちる**（testing-library は直下テキストノードのみ連結）。数字は `<em>` を直接取る
- 締切ラベル「締切」は当日だけ `text-accent-fg`（モックの `.ddl.today .lab` 準拠）。「朱は当日ピルのみ」という spec 文言より1箇所多いが逸脱ではない
