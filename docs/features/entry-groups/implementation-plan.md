---
status: completed
---
# entry-groups（申込グループ）実装手順書

> 要件: [requirements.md](requirements.md)（AC 24件）。
> **実装開始は event-detail-redesign 出荷後**（/events/[id] の二重改修回避。requirements §6）。
> deep-advisor 相談済み（2026-07-26）: 一意制約は単純付け替え+fail-loudly ガード／migration は
> Wave に合わせて 0045/0046/0047 の3本に分割（各タスクと同時に land し中間コミットを常に green に保つ）／
> lottery raw SQL は EXISTS 書き換え（非正規化は禁止）／bulk action 新設+既存 action はラッパー化。
> 本番事実確認済み（2026-07-26 read-only）: クラスタ単位で broadcasts 高々1行・assigned channel 高々1つ・
> NULL 締切は draft 無し単独イベント（テスト/女流BC）のみ。

## 共通の設計決定（全タスク前提）

- **クラスタ規則**（backfill と承認フォーム提案で必ず同一に）: `tournament_draft_id` が同じ AND
  `entry_deadline` が `IS NOT DISTINCT FROM` で一致 → 同一グループ。draft 無しはシングルトン
- **グループ表示名は導出**: `deriveEntryGroupName(titles)`（共通接頭辞+級文字結合、同一タイトルは畳む、
  導出不能時は代表イベントタイトル）。代表イベント = 今日以降で最も近い開催日、無ければ開催日最新
- **空グループ削除は条件付き**: events・event_line_broadcasts・tournament_entry_rosters が全て0件の
  ときのみ DELETE（履歴行が残るグループは残す。FK RESTRICT は DB 側バックストップ）
- **migration 手修正パターン**: `ADD COLUMN`（nullable）→ backfill UPDATE → ガード → `SET NOT NULL` →
  制約付け替え → 旧列 DROP。FK 列には明示 index（events.editionId と同じ規約）

## 実装タスク

### タスク1: entry_groups 基盤スキーマ + migration 0045 + events INSERT 全経路のシングルトン化
- [x] 完了
- **目的:** entry_groups テーブルと `events.entry_group_id NOT NULL` を導入し「全イベントは必ずグループに属する」を確立する。この時点では既存挙動は不変（backfill クラスタ+シングルトン）
- **対応AC:** AC-1, AC-2
- **主な変更領域:**
  - packages/shared/src/schema/: `entry-groups.ts` 新規（id, createdAt のみ）・`events.ts`（entryGroupId NOT NULL, FK RESTRICT, 明示 index）・`relations.ts`・index export
  - packages/shared/drizzle/0045: CREATE entry_groups → events に nullable ADD → クラスタ backfill
    （plpgsql: draft 有りは `(tournament_draft_id, entry_deadline)` IS NOT DISTINCT FROM 単位、
    draft 無しは1行1グループ）→ SET NOT NULL → index
  - apps/web/src/lib/entry-groups.ts 新規: `createEntryGroup(tx)` / `createSingletonGroupForEvent` ヘルパー
  - events INSERT 全経路への適用: `apps/web/src/app/(app)/events/new/page.tsx`（createEvent）、
    `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` L155 付近（手動紐付け経路）と L552 付近
    （approveDraftUnits。**このタスクでは unit ごとにシングルトン生成でよい**。クラスタ提案は タスク7）
  - テストシード: events を直接 INSERT する全テストの修正。`apps/web/src/test-utils/` に
    シード共通ヘルパーを新設し散在を防ぐ（タスク3/8 での再修正を最小化）
- **依存タスク:** なし
- **必要なテスト:** backfill クラスタ規則のテスト（多摩5件→2グループ・秋田2件→2グループ・draft無し→シングルトン・NULL締切 IS NOT DISTINCT FROM）、createEvent がシングルトンを自動生成すること
- **★AC-2 の検証方法（2026-07-27 追記・着手前に確定）:** vitest の global-setup は
  `drizzle-kit push --force` で**最終スキーマを直接 push する**ため、migration ファイルの
  backfill SQL は**テストスイートで一度も実行されない**。よって AC-2 を「migration を流す」
  形では検証できない。2段構えにする:
  1. クラスタ規則を**純関数** `clusterEventsByEntryGroup(rows)` として `lib/entry-groups.ts` に
     置き、多摩5件→2/秋田2件→2/draft無し→シングルトン/NULL締切の同値性をユニットテストで固定する
     （この関数は タスク7 の承認フォーム提案でも再利用し、規則の二重定義を防ぐ）
  2. SQL 側の意味論（`IS NOT DISTINCT FROM` の NULL 同値）は、**シード済みイベントに対して
     migration と同じ GROUP BY 式を実行する DB テスト**で固定する（最終スキーマ上で再クラスタを
     走らせる形。plpgsql と TS の乖離をここで検出する）
- **完了条件:** migration 適用済み・全既存テスト green（挙動不変）・check-types/lint 通過
- **対応Issue:** #360

### タスク2: グループ core lib + 編集フォームの付け替え + 締切系伝播
- [x] 完了
- **目的:** 表示名導出・代表イベント選定・グループ一覧クエリの core lib を作り、編集フォームに「申込グループ」欄（単独化/合流）と締切・支払い系フィールドの伝播ダイアログを実装する
- **対応AC:** AC-3, AC-18, AC-19
- **主な変更領域:**
  - apps/web/src/lib/entry-groups.ts: `deriveEntryGroupName` / `selectRepresentativeEvent` /
    `listGroupSiblings(db, eventId)` / 条件付き空グループ削除 `deleteGroupIfEmpty(tx, groupId)`
  - apps/web/src/app/(app)/events/[id]/edit/ + `apps/web/src/components/events/event-form.tsx`
    （**standalone モードのみ**。embedded=承認フォームには出さない）+ updateEvent action:
    グループ欄（現グループの日一覧表示・単独化・合流先選択〔同 draft 由来候補+検索〕）、
    締切/支払い系（entry/internal/payment deadline・lottery_date・payment_method/info・entry_method）
    変更時の伝播（チェックボックス付き確認 → 選択日へ同値保存。日固有フィールドは対象外）
- **依存タスク:** タスク1
- **必要なテスト:** 表示名導出（多摩A+多摩B→多摩AB・同一タイトル畳み・fallback）、代表選定（未来最近・全過去なら最新）、付け替え（単独化/合流/空グループ条件付き削除・履歴残存グループは削除されない）、伝播保存（選択日のみ・日固有フィールド不伝播）
- **完了条件:** 上記テスト green・既存 event-form/updateEvent テスト green
- **対応Issue:** #361

### タスク3: LINE 紐付け・配信のグループ化 + migration 0046
- [x] 完了（migration は 0046 + 0047 の2本。上の「migration 番号の実績」参照）
- **目的:** event_line_broadcasts と line_channels の帰属を entry_group へ移し、紐付け・配信・要綱・自動解放をグループ単位にする
- **対応AC:** AC-4, AC-5, AC-6, AC-7
- **主な変更領域:**
  - packages/shared/src/schema/: `event-line-broadcasts.ts`（event_id → entry_group_id NOT NULL **UNIQUE**
    RESTRICT。行再利用セマンティクス維持）・`line-channels.ts`（assigned_event_id → assigned_entry_group_id
    UNIQUE SET NULL）・`relations.ts`
  - packages/shared/drizzle/0046: 新列 ADD → `UPDATE ... FROM events` backfill →
    **fail-loudly ガード**（`GROUP BY entry_group_id HAVING count(*)>1` で RAISE EXCEPTION。
    assigned 側も同様）→ SET NOT NULL/UNIQUE → 旧列 DROP
  - apps/web/src/app/(app)/events/[id]/actions.ts: generateInviteCodeForEvent（引き先を group に。
    既存行 findFirst→同一行 UPDATE の再利用セマンティクスは維持）・revokeBroadcast・
    extendBroadcastLifetime・setGuidelineAttachments・resendGuidelines・manualBroadcast
  - apps/web/src/lib/line-webhook-handler.ts: handleInviteCode/handleLeave の channel
    assigned 付け替え・`event-lifecycle-notify.ts` の applyPushFailureRecovery ガード
    （assignedEventId=eventId → assignedEntryGroupId=groupId）
  - apps/web/src/lib/line-broadcast.ts（broadcastMailToEvent → group）・line-broadcast-guidelines.ts
  - **broadcastApprovedUnits**（admin/mail-inbox/actions.ts L300-317）: lineGroupId 重複排除 →
    「distinct entry_group ごとに1回」へ（AC-6）
  - **apps/web/scripts/release-expired-broadcasts.ts**: 判定を「グループ内 `MAX(event_date)`+30日」へ
    仕様変更（events への join を group 経由に）
  - apps/web/src/app/(app)/events/[id]/page.tsx: LINE セクションの読み出しをグループ基準に
    （どの日から見ても同一状態）
- **依存タスク:** タスク2（events/[id] 系ファイルの直列化）
- **必要なテスト:** グループ単位の発行/解除/延長/要綱維持（AC-4）・1グループ1有効紐付け（AC-5）・
  複数日グループへの配信1回（AC-6）・migration 移行の保全（AC-7 相当のスキーマレベルテスト）・
  release-expired の MAX(event_date) 判定・既存 broadcast/webhook/guidelines テストの移行
- **完了条件:** 全 broadcast 系既存テスト（移行後）green・`git grep -l "eventLineBroadcasts.eventId"` = 0
- **対応Issue:** #362

### タスク4: 進行操作の一括化 + 通知集約 + 詳細画面グループヘッダ
- [x] 完了
- **目的:** 申込済/支払済等の一括トグル（チェックボックス付き伝播ダイアログ）と通知の1通集約、/events/[id] のグループ日リンクを実装する
- **対応AC:** AC-8, AC-9, AC-10, AC-11, AC-16
- **主な変更領域:**
  - apps/web/src/app/(app)/events/[id]/actions.ts: **bulk 版を新設**（`setEntriesApplied(eventIds[])` 等。
    tx 内で id **昇順ソート**→各 event ガード付き UPDATE→flip できた event のみ claim〔cancelled は
    tx 内で再ガード〕→commit 後に claim 集合で参加者1通+会計1通）。既存単一 action は
    `bulk([id])` への薄いラッパーに縮退（既存テスト・文面互換を維持）
  - apps/web/src/lib/event-lifecycle-notify.ts: buildLifecycleMessage の複数日拡張。
    **会計向けは「payment 系が全日同値なら1回表記・差があれば日別行」**（N=1 は現行文面と同一）
  - apps/web/src/app/(app)/events/[id]/: EventLifecycleSection への確認ダイアログ
    （同グループの該当日を既定全チェック・cancelled 選択不可）、グループ日リンクヘッダ
    （全ロール表示・シングルトンでは非表示）コンポーネント新設 + page.tsx 配線
- **依存タスク:** タスク3（events/[id]/actions.ts・event-lifecycle-notify.ts の直列化）
- **必要なテスト:** 一括 flip+claim+1通集約（AC-8）・部分選択→後追い分のみ通知（AC-9）・支払い系（AC-10）・
  cancelled 除外（AC-11）・N=1 文面が現行と同一・未 linked は全日 skipped claim・日リンク表示（AC-16）
- **完了条件:** lifecycle 系既存テスト（ラッパー経由）green・新規テスト green
- **対応Issue:** #363

### タスク5: リマインダー・管理者アラートのグループ集約
- [ ] 完了
- **目的:** 締切リマインドを（グループ, 種別, 締切日）単位1通に、entry-overdue-alert をグループ1行に集約する
- **対応AC:** AC-12, AC-13
- **主な変更領域:**
  - apps/web/scripts/send-lifecycle-reminders.ts: 対象抽出を group join に変更（linked 判定の
    INNER JOIN は**維持** — 未 linked グループは claim 自体しない）、（グループ, 種別, 締切日）バケットの
    claim を `INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING event_id` の**1文**で原子化、
    claim できた日を列挙した1通を送信→各行 finalize
  - apps/web/src/lib/entry-overdue-alert.ts: グループ単位で1行（グループ内該当日をまとめる）
- **依存タスク:** タスク4（buildLifecycleMessage 複数日拡張を使用）
- **必要なテスト:** 同締切日の集約1通・締切が異なる日は別通（AC-12）・cron 再実行で残り分のみ追加1通・
  二重 claim なし・overdue のグループ1行（AC-13）
- **完了条件:** reminders/overdue 系テスト green
- **対応Issue:** #364

### タスク6: 申込管理ボードのグループカード化
- [ ] 完了
- **目的:** /admin/entries を1グループ=1カード（グループ共通の締切/抽選日+日別進行行）にし、代表イベント詳細へ遷移させる
- **対応AC:** AC-14, AC-15
- **主な変更領域:**
  - apps/web/src/app/(app)/admin/entries/page.tsx: 母集団クエリに entry_group_id を含めグループ集約
  - apps/web/src/app/(app)/admin/entries/entry-board-utils.ts: 型を「グループ+日別行」に再設計
    （日別 classify は維持し、区画はグループ単位に集約。表示名・代表選定はタスク2の lib を利用）
  - apps/web/src/app/(app)/admin/entries/EntryBoardClient.tsx: グループカード+日別行+代表リンク
- **依存タスク:** タスク2（lib）。タスク5・7 と並行可（変更領域が互いに素）
- **必要なテスト:** グループカード集約表示（AC-14）・代表リンク（AC-15）・区画分類のグループ集約規則・
  シングルトンは従来同等の見え方
- **完了条件:** admin/entries 系既存テスト（再設計後）green
- **対応Issue:** #365

### タスク7: 承認フォームの自動グループ提案
- [ ] 完了
- **目的:** AI 承認時に同 draft×同申込締切でグループを自動提案し、ユニットごとに割当変更できるようにする
- **対応AC:** AC-20
- **主な変更領域:**
  - apps/web/src/app/(app)/admin/mail-inbox/components/ApprovalForm.tsx: グループ提案 UI
    （クラスタ規則は backfill と同一の IS NOT DISTINCT FROM。ユニット1件なら UI 非表示で
    シングルトン）。「開催紐付け」「要綱選択」Card と同列の配置
  - apps/web/src/lib/form-schemas.ts: `${unitKey}__group_key` の追加
  - admin/mail-inbox/actions.ts の approveDraftUnits: 割当どおりに entry_groups を作成し
    events.entry_group_id へ。**部分承認との整合**: 後続バッチの unit は、同 draft の承認済み
    events をクラスタ規則で照合し既存グループへ合流（バッチを跨いでも同一グループに収束）
- **依存タスク:** タスク3（admin/mail-inbox/actions.ts の直列化）。タスク5・6 と並行可
- **必要なテスト:** 自動提案のクラスタ規則・割当変更の反映（AC-20）・部分承認のグループ収束・
  冪等性（onConflictDoNothing 経路でグループが二重生成されない）
- **完了条件:** mail-inbox 系既存テスト green・部分承認収束/冪等性テスト green
- **対応Issue:** #366

### タスク8: 名簿のグループ化 + migration 0047 + lottery 回帰
- [ ] 完了
- **目的:** tournament_entry_rosters の帰属を entry_group へ移し、名簿 UI・採用フロー・lottery 系集計を追随させる
- **対応AC:** AC-17, AC-22（AC-21/23 は全タスク横断の回帰）
- **主な変更領域:**
  - packages/shared/src/schema/tournament-entry-rosters.ts: event_id → entry_group_id NOT NULL
    **RESTRICT**（cascade にしない — 空グループ削除が名簿を道連れにしないため）。
    UNIQUE を (entry_group_id, roster_type, version) へ。relations.ts
  - packages/shared/drizzle/0047: 付け替え（本番0行だが手修正パターンは踏襲）
  - apps/web/src/lib/roster-import/materialize.ts: 直列化ロックを events 行 → entry_groups 行の
    FOR UPDATE へ。version 採番をグループ基準に
  - apps/web/src/app/(app)/events/[id]/: page.tsx の名簿クエリ・RosterSection
    （グループ内どの日からも同一表示）
    - **★2026-07-27 訂正（event-detail-redesign / PR #376 出荷による）**: 本手順書が書かれた時点に
      あった `uploadRoster`（この画面の Excel 取込 Server Action）と `RosterUploadForm` は**削除済み**で、
      このタスクの変更対象から**外す**（`git grep uploadRoster` = 0件）。`RosterSection` の props も
      `{ kind, rosters, currentUserId }` に変わっている（`eventId` / `isAdmin` は削除済み）
    - **AC-17 の「アップロード」は `approveRosterImportDraft` → `materializeRoster`（メール取込経由）
      のみを指す**と読み替える。この画面からの取込導線はもう存在しない
    - ★page.tsx の名簿クエリには `columns` 指定（表示列だけを取る）が入っている。`RosterSection` が
      client component で RSC payload へ直列化されるため、**グループ基準へ書き換える際にこの列制限を
      落とさないこと**（落とすと note / rawKana / rawDan / selectionOutcome 等が会員へ漏れる）
  - apps/web/src/app/(app)/admin/mail-inbox/roster-drafts/[id]/: 対象選択をグループ基準へ
    （page.tsx の events join 修正含む）+ approveRosterImportDraft
  - apps/web/src/lib/lottery/appearance-counts.ts・series-metrics.ts: 整合性チェック join を
    `EXISTS (SELECT 1 FROM events e WHERE e.entry_group_id = roster.entry_group_id AND
    e.edition_id = publication.edition_id)` へ書き換え。series-metrics の
    applicant/selection_event_edition_id 抽出箇所は「グループ内に一致 event が存在するか」の
    boolean EXISTS 化（**edition_id の非正規化は禁止** — approveDraftUnits の後付け edition 紐付けで
    stale になるため）
  - apps/web/src/app/(app)/admin/entries/page.tsx: 確定名簿有無チェックをグループ基準へ
- **依存タスク:** タスク4・タスク6・タスク7（events/[id]/actions.ts・admin/entries・mail-inbox/actions.ts の直列化）
- **必要なテスト:** グループ基準のアップロード/版採番/差し替え/表示（AC-17）・lottery 系既存テスト
  （appearance-counts/series-metrics/adoption/schema）green（AC-22）・roster-drafts 採用フロー
- **完了条件:** `git grep "tournamentEntryRosters.eventId"` = 0・lottery 系テスト green・
  **page.tsx の名簿クエリの `columns` 列制限が維持されている**（会員への内部列漏洩の回帰ガード）
- **対応Issue:** #367

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1（スキーマ基盤 + migration 0045。共有ホットスポット先行）
- Wave 2: タスク2（core lib + 編集フォーム）
- Wave 3: タスク3（LINE グループ化 + migration 0046）
- Wave 4: タスク4（一括操作 + 通知集約 + 詳細ヘッダ）
- Wave 5: タスク5, タスク6, タスク7（**並行**。T5=scripts+entry-overdue-alert / T6=admin/entries /
  T7=mail-inbox で変更領域が互いに素）
- Wave 6: タスク8（名簿 + migration 0047。events/[id]・admin/entries・mail-inbox を跨ぐため最後に直列）

## 注意事項

### ★migration 番号の実績（2026-07-27 更新・計画とずれた）

`drizzle-kit generate` は「同一テーブルで1列 追加 + 1列 削除」を**リネーム候補と見なして対話
プロンプトを要求**し、非TTY 環境（Claude Code の Bash）では必ず失敗する。回避のため FK 列の
付け替えは **「新列 ADD のみ」→「旧列 DROP」の2パス**に分ける必要があり、**migration が
1本ずつ増える**。実績:

| 計画 | 実績 | 内容 |
|---|---|---|
| 0045 | `0045_fresh_tag` | events.entry_group_id 追加 + クラスタ backfill（**手修正版**） |
| 0046 | `0046_busy_thunderball` | LINE: 新列 ADD + backfill + fail-loudly ガード + NOT NULL/UNIQUE（**手修正版**） |
| — | `0047_long_la_nuit` | LINE: 旧列 DROP（自動生成のまま） |
| 0047 | **0048 + 0049 になる見込み** | 名簿（タスク8）も同じ2パスが必要 |

番号は実装詳細であり、**同一 PR に全部入れる**限り本番が中間状態を見ることはない。
`0045` / `0046` は手修正版なので **`db:generate` で上書きしないこと**。

- **PR は1本**（migration の本数はタスク単位の分割であって PR 単位ではない。LINE 適用後・
  名簿 未適用の混在状態を本番に置かないため）
- **並行作業**: event-grade-group-broadcast（#313・未実装）が migration 0044 を想定していた記録があるが
  main は 0044 まで使用済み。#313 実装時に番号を振り直すこと（本機能が 0045-0047 を使用）。
  #313 は本機能の**後**に実装し、mail-inbox 側は rebase で追随
- **実装開始条件**: event-detail-redesign 出荷後
