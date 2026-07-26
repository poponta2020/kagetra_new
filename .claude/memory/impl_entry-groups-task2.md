---
name: impl-entry-groups-task2
description: entry-groups タスク2完了(残6)
type: project
---

entry-groups（親Issue #359）**タスク2 完了**。ブランチ `feature/entry-groups`・commit b77ac1c（push 済み）。**タスク1-2 完了 / タスク3-8（#362-#367）未着手。** 前提は [[impl-entry-groups-task1]] を先に読むこと。

## タスク2（#361）で入ったもの
`apps/web/src/lib/entry-groups.ts` に core lib を集約:
- `deriveEntryGroupName(titles): string | null` — 純関数。全同一→そのまま／共通接頭辞+残りが級文字1文字→昇順連結（多摩A+多摩B→多摩AB）／**導出不能は null**（呼び出し側が代表イベントのタイトルへフォールバック）
- `selectRepresentativeEvent(events, todayStr)` — 純関数。`Date.now()` を読まず注入。今日以降で最近→無ければ最新。同着は id 昇順。cancelled も候補に含む
- `listGroupSiblings(db, eventId)` — 表示に必要な最小列のみ（client component へ渡るので payload を太らせない）
- `deleteGroupIfEmpty(tx, groupId)` — **entry_groups 削除の唯一の経路**。親行 FOR UPDATE → events 0件判定
- `applyEntryGroupChange` / `diffPropagatableFields` / `propagateFieldsToGroup` / `listMergeCandidateGroups`

UI: `entry-group-fieldset.tsx`（グループ欄）と `event-edit-submit.tsx`（伝播確認ダイアログ）を新設。`event-form.tsx` に差し込み prop を追加（**standalone のみ**描画。embedded=承認フォームには出さない）。

## ★次セッションが引き継ぐべき設計判断・注意点

1. **伝播対象の再検証は UPDATE の WHERE で行っている** — `propagateFieldsToGroup` は
   `and(inArray(events.id, ids), eq(events.entryGroupId, groupId))` で更新する。
   クライアントが任意の event id を送っても同一グループ外は更新されない（事前チェックではなく DB レベル）
2. **`diffPropagatableFields` の `after` は `...data` ではなく7フィールドを手動列挙している。**
   ここが日固有フィールド（title/eventDate/級/定員/参加費 等）を伝播させない唯一の砦。触るときは要注意
3. **グループ付け替えと伝播は同時に成立させない**（requirements に明記が無い箇所の解釈）。
   伝播ダイアログは旧グループの日一覧から作られるため、同じ保存で移動すると前提が崩れる。
   client と server の両側で `groupAction !== 'keep'` なら伝播を無視する
4. **`deleteGroupIfEmpty` に条件を足すのは タスク3/8**。いまは events 0件だけを見ている。
   `event_line_broadcasts`（タスク3）と `tournament_entry_rosters`（タスク8）がグループ帰属に
   なったら、**この関数に**0件チェックを追加する（削除条件を1箇所に保つ設計意図を doc コメントに明記済み）
5. **§3.2.6 の「移動元に LINE 紐付け・名簿が残る」はタスク2 時点では成立しない**（まだ event 帰属で
   物理的にイベントに追従する）。「履歴が残るグループは削除されない」ケースもまだ作れない。タスク3/8 で成立させる
6. `updateEvent` は page.tsx 内の inline `'use server'` closure のため**直接のテストが無い**
   （既存 createEvent/updateEvent も同様でリポジトリの既存パターン）。core lib 側は実 DB テストで covered。
   main が配線を目視確認済み（保存前スナップショット→自更新→付け替え→伝播の順序・伝播は keep のみ）

## 検証（タスク2 時点）
Vitest **1844 passed / 1 skipped（133 files・全 green）**・check-types clean・eslint clean。
タスク2 で +57 テスト（entry-groups.test 25 / entry-groups.sql.test 24 / event-form 17 → 一部既存 / fieldset 7 / submit 8）。

## 残り（Wave 順）
Wave3=#362 タスク3（LINE 紐付け・配信のグループ化 + **migration 0046**）→ Wave4=#363 タスク4（一括操作+通知集約）
→ Wave5=**#364/#365/#366 並行可**（scripts / admin-entries / mail-inbox で領域が互いに素）→ Wave6=#367 タスク8（名簿 + **migration 0047** + lottery 回帰）。
**PR は1本**（0046 適用済み・0047 未適用の状態を本番に置かない）。
migration の検証は scratch DB `kagetra_migtest`（0045 適用済みで残置）へ順に当てて実測する。
