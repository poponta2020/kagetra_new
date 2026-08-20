---
status: completed
---
# entry-group-page 実装手順書

> 親Issue: #496 ／ 子Issue: #497〜#502

> 要件: [requirements.md](requirements.md)（completed・2026-08-20 承認）
> 視覚の正: [design-spec.md](design-spec.md)（locked・`chosen_direction: C`）＋ `design-mock/`
> **マイグレーション無し**（新テーブル・新列・型変更いずれも無い）

## 技術設計の確定事項（調査で解決した論点）

1. **フェーズ1語はボードの `classify()` をそのまま流用する。**
   `classify(item: EntryBoardItem, todayStr): AreaId` は**既にイベント単位の純関数**で、
   `EntryBoardItem` も1イベント1件。グループページは自分の日ぶんの `EntryBoardItem` を組んで
   同じ関数を回すだけでよい（判定ロジックを二重に持たない）。design-spec §10 の懸案はこれで解消。
   - `AreaId` → 日程表の短縮ラベルの対応（**ボードの `AREAS.label` から機械的に短縮**）:
     `before_deadline`→締切前 / `action_required`→**要申込** / `applied_waiting`→抽選待ち /
     `payment_due`→**要振込** / `done`→完了
   - `classify` は「申し込まない」と「未申込かつ希望者0名」を**どちらも `no_applicants`** に畳むので、
     日程表では `entryStatus` で割り直す: `not_applying`→**申込なし** / `not_applied`→**希望者なし**
   - `status='cancelled'` の日は `classify` にかけず **中止** 固定
2. **共通項目の編集はインライン**（サブページを作らない）。7項目すべて日付/短いテキストで、
   往復するほどの分量ではない。`/admin/entries/[groupId]/edit` を作ると `/events/[id]/edit` と
   役割が紛らわしくなる。
3. **バルク Server Action で足りないのは1本だけ。**
   `setEntriesApplied(ids, true|false)` / `setPaymentsPaid(ids, true|false)` / `setPaymentTypes(ids, type)`
   は既にバルク版がある（後退方向も `false` 引数で賄える）。**`setEntryNotApplying` だけが単一版のみ**
   なのでバルク版を新設する。
4. **共通項目のグループ一括保存は `propagateFieldsToGroup` を再利用する。**
   `targetEventIds`＝グループ全イベント・`excludeEventId` なしで呼ぶだけ。昇順ロック・
   `entry_group_id` 併記の fail-closed もそのまま効く。
5. **日程表の大会名は `displayName(item)`**（通称ベース）をボードと同じく使う。
6. **ボトムナビは変更不要** — `matches: ['/admin/entries']` が前方一致なので `[groupId]` でも点灯する
   （`bottom-nav.test.tsx` に `/admin/entries/42` のケースが既にある）。テストの追加だけ。

## 実装タスク

### タスク1: 集約の純関数2本
- [ ] 完了
- **目的:** グループのフロー帯入力と、日程表のフェーズ1語を、DB 非依存の純関数として確定させる。
- **対応AC:** AC-10, AC-11, AC-12, AC-13, AC-14, AC-15
- **主な変更領域:**
  - `apps/web/src/lib/events/group-entry-flow.ts`（新規）— `aggregateGroupFlowInput(days, todayStr)`。
    戻り値は既存 `EntryFlowInput`。**`buildEntryFlow` は一切変更しない。**
    対象日が空（全日 cancelled）なら `null` を返し、呼び出し側がフロー帯を描かない。
  - `apps/web/src/lib/events/group-common-fields.ts`（新規）— 共通値の決め方（一致ならその値／
    食い違えば最も早い日付・日付以外は代表イベントの値＋`varies: true`）。
  - `apps/web/src/app/(app)/admin/entries/day-phase.ts`（新規）— `dayPhaseLabel(item, todayStr)`。
    `entry-board-utils.ts` の `classify` / `AREAS` を import する**兄弟モジュール**として置く
    （lib から app ディレクトリを import しない）。
  - 各 `.test.ts`（テストファースト）
- **依存タスク:** なし
- **必要なテスト:**
  - 集約規則の表（requirements §3.2.4）の各行
  - **本番実測4形の検算**（多摩CDE / 全日本30周年 / 杉並AB / 九段E+CDE）を固定値のフィクスチャで
  - 全日 cancelled → `null`
  - 短縮ラベルが `AREAS` の label から導出されていること（`AREAS` を改称したら落ちるテスト＝語彙の同期を機械で守る）
  - `no_applicants` の割り直し（申込なし / 希望者なし）と cancelled → 中止
- **完了条件:** 新規テスト green・typecheck 通過
- **対応Issue:** #497

### タスク2: Server Action の不足分と共通項目の一括保存
- [ ] 完了
- **目的:** グループページから必要な書き込みが全部できる状態にする（UI より先に）。
- **対応AC:** AC-16, AC-17, AC-18, AC-19, AC-20
- **主な変更領域:**
  - `apps/web/src/app/(app)/events/[id]/actions.ts` — `setEntriesNotApplying(eventIds)` を新設し、
    既存 `setEntryNotApplying(eventId)` を `setEntriesNotApplying([eventId])` の薄いラッパーへ縮退
    （既存の単一版の挙動・`revalidatePath` 対象を変えない）。**通知は送らない**既存規律を維持。
  - `apps/web/src/app/(app)/admin/entries/[groupId]/actions.ts`（新規）—
    `saveGroupCommonFields(groupId, input)`。`requireAdminSession()` → 同一 tx で
    `propagateFieldsToGroup`（対象＝グループ全イベント・cancelled 含む）。支払締切は
    `normalizePaymentDeadline` を必ず経由して日付と `payment_deadline_kind` を揃える。
    保存後に `/admin/entries/[groupId]`・グループ内全 `/events/[id]`・`/events` を revalidate。
- **依存タスク:** なし（タスク1 と変更領域が重ならない）
- **必要なテスト:**
  - `setEntriesNotApplying`: 複数日を同一 tx で `not_applying` へ・**通知が送られない**・
    単一版ラッパーの挙動が既存テストのまま green
  - `saveGroupCommonFields`: 全日（cancelled 含む）へ同値保存・非管理者は拒否・
    支払締切の日付と kind が常に整合（CHECK 違反が起きない）・7項目以外を書き換えない
- **完了条件:** 新規テスト green・既存の `actions.bulk-lifecycle.test.ts` / `lifecycle-actions.test.ts` が green
- **対応Issue:** #498

### タスク3: グループページ本体
- [ ] 完了
- **目的:** `/admin/entries/[groupId]` を design-spec の確定形で作る。
- **対応AC:** AC-1〜AC-9, AC-22, AC-23, AC-24, AC-25, AC-26, AC-35
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/entries/[groupId]/page.tsx`（新規・Server Component）—
    ゲスト fail-safe の `redirect('/403')`・404 条件（存在しない groupId / イベント0件）・
    非管理者には管理情報を **RSC payload に載せない**（`columns` を絞る／値を計算しない）
  - `apps/web/src/app/(app)/admin/entries/[groupId]/components/GroupDayTable.tsx`（新規・client）—
    選択状態＋一括操作。チェックボックスは行リンクの外の独立したタップ標的
  - `apps/web/src/app/(app)/admin/entries/[groupId]/components/CommonFieldsSection.tsx`（新規・client）—
    インライン編集（確定事項2）
  - `apps/web/src/lib/event-related-mails.ts` — `collectRelatedMailIdsForGroup(db, eventIds)` を追加
    （既存 `collectRelatedMailIds` は据え置き。UNION して mail id で dedup）
  - 既存コンポーネントの再利用: `EntryFlow` / `SectionRule` / `DisclosureRow` / `FlatTable` /
    `LineBroadcastSection` / `RosterSection` / `OpenChatSection` / `EventRelatedMails`
- **依存タスク:** タスク1, タスク2
- **必要なテスト:**
  - ロール別の到達（admin/vice_admin/member=200・guest=/403）と **RSC payload に管理情報が出ない**こと
  - 表示ロールのプレビュー中（member）で操作 UI が出ない
  - 404（存在しない groupId・イベント0件のグループ）
  - グループ名の導出と null フォールバック（九段E+九段CDE）
  - 日程表の並び・cancelled 行の表示と選択不可・参加希望者数のゲスト除外・自分の回答印
  - 団体戦で名簿と申込書の導線が出ない
- **完了条件:** 新規テスト green・typecheck 通過
- **対応Issue:** #499

### タスク4: 日ページと編集フォームの整理（delta）
- [ ] 完了
- **目的:** 移設元から撤去し、日ページを会員向けに純化する。**タスク3 の後に行う**（先に外すと機能が一時的に消える）。
- **対応AC:** AC-21, AC-28, AC-29, AC-30
- **主な変更領域:**
  - `apps/web/src/app/(app)/events/[id]/page.tsx` — 進行管理・LINE配信・関連メールの3セクションと
    `GroupDayLinks` を撤去。**このファイルにヘルパーコンポーネントを増やさない**
    （`page-padding.test.ts` が「`  return (` がちょうど1本」を機械検査）
  - `apps/web/src/components/events/detail/GroupBackLink.tsx`（新規）＋ `GroupDayLinks.tsx` 削除
    （テストも置換）
  - `apps/web/src/app/(app)/events/[id]/edit/page.tsx` ＋ `components/events/event-form.tsx` —
    共通7項目を撤去。`EventEditSubmit` の伝播確認ダイアログと `GroupToggleDialog` を撤去
    （`diffPropagatableFields` / `propagateFieldsToGroup` は**タスク2 が使うので残す**）
  - `apps/web/src/components/events/EventLifecycleSection.tsx` — 日ページから外れるので
    グループページ専用になる。`groupSiblings` によるダイアログ分岐を落とす
- **依存タスク:** タスク3
- **必要なテスト:**
  - 日ページに3セクションと日リンク帯が出ないこと（管理者でも）
  - グループ導線が**シングルトンでも**出て、固定文言であること
  - 日ページのフロー帯が**日別判定のまま**であること
  - 編集フォームに共通7項目が無く、保存時に伝播ダイアログが出ないこと
  - `page-padding.test.ts` が green のままであること
- **完了条件:** 既存テストの置換が済み、`apps/web` の該当スイートが green
- **対応Issue:** #500

### タスク5: 着地点の張り替え
- [ ] 完了
- **目的:** ボードとアラートの遷移先をグループページへ向ける。
- **対応AC:** AC-27, AC-31, AC-34
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/entries/EntryBoardClient.tsx` — 行の `href` を
    `/events/${representativeEventId}` → `/admin/entries/${groupId}` へ。**区画・仕分け・並び順・
    表示項目は触らない**
  - `apps/web/src/app/(app)/admin/entries/page.test.tsx` — href アサーション **4本**を更新
    （計画的に壊れるテスト）
  - `apps/web/src/lib/entry-overdue-alert.ts:399` — 本文 URL をグループページへ
  - `apps/web/src/components/layout/bottom-nav.test.tsx` — `/admin/entries/[groupId]` で
    「申込管理」タブが active になるケースを明示（実装変更は不要）
- **依存タスク:** タスク3
- **必要なテスト:** 上記の更新分＋`entry-overdue-alert` の URL テスト
- **完了条件:** 該当スイート green
- **対応Issue:** #501

### タスク6: 回帰の確認と正典の整合
- [ ] 完了
- **目的:** 撤回した既存 AC を記録に残し、回帰が無いことを機械で確認する。
- **対応AC:** AC-32, AC-33, AC-36, AC-37
- **主な変更領域:**
  - `docs/features/entry-groups/requirements.md` — §3.1・§3.2.4・§3.2.7 と AC-15/AC-16/AC-19 に
    **日付入りの撤回注記**を入れる（2026-07-28 の日別行撤回と同じ書式）。本文は消さず注記で上書きする
  - `docs/features/INDEX.md` の該当行を更新（出荷時は `/ship` が付ける）
  - 会員向け LINE 通知（申込完了・支払・締切リマインド）の文面・URL が不変であることの回帰テスト確認
- **依存タスク:** タスク4, タスク5
- **必要なテスト:** 既存テスト全体（CI）／design-spec §8 忠実度チェックリストの全項目確認
- **完了条件:** design-spec §8 を1項目ずつ確認して全てクリア・CI green
- **対応Issue:** #502

## 実装順序（Wave = 並行実装できるタスクの組）
- **Wave 1: タスク1, タスク2** — 純関数（`lib/events/` ＋ `admin/entries/day-phase.ts`）と
  Server Action（`events/[id]/actions.ts` ＋ `admin/entries/[groupId]/actions.ts`）。変更領域が互いに素
- **Wave 2: タスク3** — Wave 1 の両方に依存
- **Wave 3: タスク4, タスク5** — タスク4 は `events/[id]` 配下＋`components/events/`、
  タスク5 は `admin/entries/` 直下＋`lib/entry-overdue-alert.ts`＋`components/layout/`。変更領域が互いに素
- **Wave 4: タスク6** — 全部の後
