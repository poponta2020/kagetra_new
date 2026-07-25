---
status: completed
---

# event-grade-group-broadcast 実装手順書

## 技術設計の要旨（requirements §6「未解決の技術論点」の解決）

| 論点 | 決定 |
|---|---|
| 級グループの常設紐付け | **新テーブル `line_grade_group_bindings`**。`event_line_broadcasts` は `event_id` が NOT NULL + UNIQUE + FK RESTRICT のため常設紐付けを表現できない。`grade` を UNIQUE にして AC-20（1級2グループ不可）を DB 層で保証し、再紐付けは同一行 UPDATE（`event_line_broadcasts` と同じ流儀） |
| `(大会, 級)` の送信済み記録 | **新テーブル `event_grade_broadcasts`**、`UNIQUE (event_id, grade)`。`event_lifecycle_notifications` の `type` enum に級を混ぜるとライフサイクル通知ドメインを汚すため分離。**claim → push → 確定/取消** 方式: `INSERT ON CONFLICT DO NOTHING RETURNING` で claim（`sent_at` NULL）→ push 成功で `sent_at` を刻む → 失敗なら claim 行を DELETE。これで AC-8（二重送信なし）と AC-9（失敗級は未送信のまま）を同時に満たす |
| 要綱添付の保存先 | **`events` に `grade_broadcast_attachment_id` を追加**。`event_broadcast_guideline_attachments` は `event_line_broadcasts` にぶら下がり新規登録時点で親行が無い。FK は `events → mail_attachments → mail_messages → events` の型循環を避けるため **raw ALTER で付与**（`events.tournament_draft_id` と同じ既存パターン） |
| 手動作成経路の要綱選択 | `/events/new` には添付が存在しないため **UI を出さない**（列は NULL のまま）。分岐は承認フォーム側だけに持つ |
| webhook の排他 | `loadChannelByDestination` の `purpose` フィルタを `IN ('event_broadcast','grade_broadcast')` へ広げ、**解決したチャネルの `purpose` で処理を振り分ける**。1チャネル = 1 purpose なので排他は構造的に保証される |
| チャネルの確保 | 招待コード発行時に `purpose='event_broadcast' AND status='available'` から1個を楽観ロックで取り、同一トランザクションで `purpose='grade_broadcast'` へ転換する（既存 `reserveAvailableChannel` と同型）。運用スクリプトは不要 |
| 管理者通知 | `entry-overdue-alert.ts` の `loadSystemChannel` / `pushSystemText` を再利用する（既に export 済み）。**既存モジュールのリファクタはしない** |
| マイグレーション番号 | 最新が `0043` のため **`0044`**。並行 worktree があるため実装時に再確認する |

## 実装タスク

### タスク1: スキーマとマイグレーション

- [x] 完了
- **目的:** 級グループの常設紐付け・`(大会, 級)` 送信記録・要綱添付参照を DB に定義する
- **対応AC:** AC-8, AC-9, AC-20, AC-23
- **主な変更領域:** `packages/shared/src/schema/enums.ts`（`lineChannelPurposeEnum` に `grade_broadcast` 追加 / `lineGradeGroupStatusEnum` 新設）、`packages/shared/src/schema/line-grade-group-bindings.ts`（新規）、`packages/shared/src/schema/event-grade-broadcasts.ts`（新規）、`packages/shared/src/schema/events.ts`（`gradeBroadcastAttachmentId` 追加）、`packages/shared/src/schema/index.ts`、`packages/shared/drizzle/0044_*.sql`
- **依存タスク:** なし
- **必要なテスト:** スキーマの型が通ること。`grade` UNIQUE と `(event_id, grade)` UNIQUE が実際に重複を弾くことをテスト DB で確認
- **完了条件:** `pnpm check-types` 通過 / `pnpm --filter=@kagetra/shared test` green / migration が空でなく生成されている
- **対応Issue:** #314

### タスク2: 配信コアロジック

- [x] 完了
- **目的:** 文面組み立て・対象級の解決・claim/push/確定・スキップと失敗の管理者通知を1モジュールに実装する
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14
- **主な変更領域:** `apps/web/src/lib/event-grade-broadcast.ts`（新規）、`apps/web/src/lib/event-grade-broadcast.test.ts`（新規）
  - `resolveTargetGrades(eligibleGrades)` — null/空なら全5級（`isGradeEligible` と同ルール）
  - `buildGradeBroadcastMessage(entries)` — 純関数。`M/D(曜) <title>の案内が来ました！` / 要綱 URL 行 / 空行 / `締切 は<M/D>です。`。要綱なし・締切なしは行ごと省略。複数件は区切り線で連結
  - `broadcastEventsToGradeGroups(db, eventIds, options)` — 級ごとに紐付け解決 → claim → push → 確定 / 失敗時 claim 削除。未紐付けと push 失敗を集計して `loadSystemChannel` + `pushSystemText` で管理者へ1通通知
  - **push 失敗時に紐付けを解除しない**（既存 `line-broadcast.ts` の 401/4xx 自動解放ロジックを持ち込まない）
  - 要綱 URL は既存 `getOrCreateShareToken()` を使う
- **依存タスク:** タスク1
- **必要なテスト:** 文面の全分岐（要綱有無 × 締切有無 × 単数/複数）／級の絞り込み（一致・null・空）／claim の二重実行で2回目が送らない／push 失敗で claim が消え紐付けが残る／未紐付けスキップで通知が呼ばれる／全級未紐付けでも例外を投げない。push と通知はモックで検証
- **完了条件:** 新規テスト green / `pnpm --filter=@kagetra/web test` green
- **対応Issue:** #315

### タスク3: webhook の級グループ対応

- [x] 完了
- **目的:** Bot 招待でグループ ID を捕捉し、6桁コードで紐付けを確定できるようにする
- **対応AC:** AC-17, AC-18
- **主な変更領域:** `apps/web/src/lib/line-webhook-handler.ts`、`apps/web/src/lib/line-webhook-handler.test.ts`
  - `loadChannelByDestination` の `purpose` フィルタを2値へ拡張し、`purpose` を戻り値に含める
  - `applyWebhookEvents` で `purpose === 'grade_broadcast'` のときに級グループ用の `join` / `message`（6桁コード）/ `leave` を処理する。既存の大会用フローには入らない
  - `leave` は `revoked` + `revoke_reason='bot_kicked'`。`memberLeft` は既存同様に無視
- **依存タスク:** タスク1
- **必要なテスト:** `grade_broadcast` チャネル宛の `join` で `line_group_id` と `joined_waiting_code` が入る／6桁コードで `linked` になる／グループ外からの redeem を拒否／`leave` で `revoked` になる／**`event_broadcast` チャネル宛の既存挙動が変わらない（回帰）**
- **完了条件:** 既存テストを含め green
- **対応Issue:** #316

### タスク4: 級グループ管理画面

- [ ] 完了
- **目的:** 管理者が級ごとに招待コードを発行し、紐付け状態を確認・解除できるようにする
- **対応AC:** AC-16, AC-19, AC-20, AC-22, AC-25, AC-26
- **主な変更領域:** `apps/web/src/app/(app)/admin/line-grade-groups/page.tsx`（新規）、同 `actions.ts`（新規）、同 `actions.test.ts`（新規）
  - `generateGradeInviteCode(grade)` — 既存行があれば再利用、無ければ `event_broadcast` かつ `available` のチャネルを楽観ロックで確保し `grade_broadcast` へ転換。6桁コードは `invite-code.ts` を再利用。友だち追加 URL を返す
  - `revokeGradeBinding(grade)` — `revoked` にして配信対象から外す
  - すべて `requireAdminSession()`（`vice_admin` を通さない）
  - 表示は A〜E の5行。見た目は `/admin/line-channels` を踏襲
  - `/admin/line-channels` は `purpose='event_broadcast'` 固定のままにする（AC-25 の回帰）
- **依存タスク:** タスク1
- **必要なテスト:** 発行でチャネルが確保され `grade_broadcast` に転換される／プール枯渇時にエラーになる／同じ級に2グループを紐付けられない／解除後に配信対象から外れる／`vice_admin`・`member`・未ログインが実行できない／`/admin/line-channels` に級用チャネルが出ない
- **完了条件:** 新規テスト green
- **対応Issue:** #317

### タスク5: 配信トリガーの配線と再送

- [ ] 完了
- **目的:** 3つの登録経路から配信を起動し、`/events/[id]` に再送導線と配信状況を出す
- **対応AC:** AC-3, AC-10, AC-15, AC-21, AC-22
- **主な変更領域:** `apps/web/src/app/(app)/events/new/page.tsx`、`apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（`approveDraft` / `approveDraftUnits` に `after()` 追加）、`apps/web/src/app/(app)/events/[id]/actions.ts`（`resendGradeBroadcast`）、`apps/web/src/app/(app)/events/[id]/page.tsx`（状況表示 + 再送ボタン）
  - すべて既存の `after()` fire-and-forget パターンに従い、失敗しても登録・承認処理を巻き戻さない
  - `approveDraftUnits` は作成した全 `event` を**1回の呼び出しでまとめて渡す**（級ごと1通に集約するため）
  - 編集経路（`events/[id]/edit`）には配線しない（AC-15）
  - `resendGradeBroadcast` は `requireAdminSession()`。未送信の級だけに送る（コアロジックの claim がそのまま効く）
- **依存タスク:** タスク2
- **必要なテスト:** 承認で対象級へ1回だけ配信が呼ばれる／複数 event 作成時に級ごと1通へまとまる／編集では呼ばれない／再送が送信済み級をスキップする／配信が例外を投げても承認が成功する／再送を `admin` 以外が実行できない
- **完了条件:** 新規テスト green / 既存の mail-inbox テストが green
- **対応Issue:** #318

### タスク6: 承認フォームの要綱選択

- [ ] 完了
- **目的:** 承認時に「LINE告知に載せる要綱」を1件選び、作成される大会に保存する
- **対応AC:** AC-12, AC-23
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/components/ApprovalForm.tsx`、`apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（`approveDraft` / `approveDraftUnits` の INSERT に `gradeBroadcastAttachmentId` を追加）
  - **【実装時の計画修正】候補は「そのドラフトの元メールの添付」とする。** 当初計画は既存
    `loadGuidelineCandidates()` の再利用としていたが、あの関数は `collectRelatedMailIds(db, eventId)`
    経由の **event スコープ**で、承認時点ではまだ event が存在しないため使えない。ドラフト詳細画面が
    既に元メールの添付を読み込んでおり、意味的にも「この案内メールの添付から要綱を選ぶ」が正しい。
    AC-23（選択でき・保存される）は満たすため要件変更ではない
  - **候補の検証は tx 内・ロック済み draft 行の `messageId` に対して行う**
    （`mail_attachments.id = 選択値 AND mail_message_id = lockedRow.messageId`）。ページが渡してきた
    候補リストや tx 前の read で検証してはならない（`unit_key` 検証を固めた r5 blocker と同じ穴）
  - **デフォルト未選択**
  - 選択は承認1回につき1件で、その承認で作られる全 `events` に同じ値を入れる
  - 未選択なら NULL（配信時に URL 行が省略される）
- **依存タスク:** タスク1
- **必要なテスト:** 選択が `events.grade_broadcast_attachment_id` に保存される／未選択なら NULL／候補外の添付 ID を弾く／分割承認で全 event に同じ値が入る
- **完了条件:** 新規テスト green
- **対応Issue:** #319

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1 (#314)**（スキーマ。全タスクの前提となる共有ホットスポットのため単独で先行）
- **Wave 2: タスク2 (#315), タスク3 (#316), タスク4 (#317), タスク6 (#319)**（変更領域が重ならない。タスク2=`lib/event-grade-broadcast.ts` 新規 / タスク3=`lib/line-webhook-handler.ts` / タスク4=`admin/line-grade-groups/` 新規 / タスク6=`admin/mail-inbox/`）
- **Wave 3: タスク5 (#318)**（タスク2 のコアロジックに依存。かつ `admin/mail-inbox/actions.ts` をタスク6 と共有するため必ず後段に置く）

## 実装後の運用手順（出荷後にユーザーが行う）

1. `/admin/line-grade-groups` で A〜E の招待コードを発行する（既存プールから5個が `grade_broadcast` へ転換される）
2. 各級の LINE グループに、表示された友だち追加 URL から Bot を招待する
3. 各グループで6桁コードを発言して紐付けを確定する
4. テスト用に大会を1件登録し、想定どおりの文面と開ける要綱 URL が届くことを確認する（AC-27）
