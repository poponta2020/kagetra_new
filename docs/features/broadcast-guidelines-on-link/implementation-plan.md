---
status: completed
---
# broadcast-guidelines-on-link 実装手順書

要件: [requirements.md](requirements.md)（AC は §4）。既存 `event-line-broadcast` への追加。機能仕様の正典 [docs/spec/notifications.md](../../spec/notifications.md) は該当箇所を実装と同じコミットで更新する。

## 技術設計（確定事項）

- **選択の保存先**: 新規 join テーブル `event_broadcast_guideline_attachments`（`event_line_broadcast_id` FK→`event_line_broadcasts` ON DELETE CASCADE、`mail_attachment_id` FK→`mail_attachments` ON DELETE CASCADE、`created_at`、`UNIQUE(event_line_broadcast_id, mail_attachment_id)`）。多選択＋FK整合＋添付削除時カスケードのため配列列でなく join テーブル。`event_line_broadcasts` は 1 大会 1 行・招待コード再発行は同一行 UPDATE なので選択は保持される。
- **監査**: `event_line_broadcasts.guidelines_sent_at timestamptz nullable` を追加（最終送信日時の表示＋観測用）。`event_broadcast_messages` は**流用しない**（full-mail 配信と `UNIQUE(broadcast, mail_message_id)` で衝突するため）。`generateInviteCodeForEvent` の binding リセットブロックで `guidelines_sent_at` も NULL に戻す。
- **送信ヘルパー**: 新規 lean モジュール `apps/web/src/lib/line-broadcast-guidelines.ts`。`line-broadcast.ts`（重依存を巻き込む）ではなくここに置き、webhook（nodejs runtime）と手動紐付けの両方から呼ぶ。`getOrCreateShareToken`（`attachment-image-render.ts`・node builtins依存のみで重バイナリはspawn/遅延なので webhook から再利用可）を再利用。LINE push は本モジュール内に自己完結の最小実装（`LINE_NOTIFY_DRY_RUN` 尊重・5通/バッチ・1.5秒間隔・429リトライ・30sタイムアウト。link-only text のみで partial-resume 等の複雑さ不要）。`line-broadcast.ts` は変更しない（高リスクパスのchurn回避）。
  - `sendGuidelinesOnLink(db, { eventLineBroadcastId, lineGroupId, channelAccessToken, baseUrl? }, options)` → 選択添付を join から取得→0件なら `{status:'skipped'}`→各添付 `getOrCreateShareToken`→`📎【大会要綱】{filename}\n{url}` を1通ずつ push→成功時 `guidelines_sent_at=now()`。best-effort（throw しない・失敗は logger.warn）。
- **候補添付の収集**: `EventRelatedMails.tsx` の `collectRelatedMailIds` を共有ヘルパー `apps/web/src/lib/event-related-mails.ts` に抽出し、両者で再利用。候補は「関連メール（受信日時降順）→各メールの `mail_attachments`（id昇順・id/filename/sizeBytes/contentType）」の入れ子。
- **モーダルへの受け渡し**: `generateInviteCodeForEvent` の返却を拡張し `guidelineCandidates`（メール別入れ子）＋`selectedGuidelineAttachmentIds`（現選択）を含める（「モーダル内選択」フローに一致）。**ただし候補（3経路union＋添付読取）は `generateInviteCodeForEvent` の予約用 write トランザクション内で読まない**——channel 予約 tx を無駄に肥大化させるため、commit **後**に読むか、別ローダー関数に切り出す（後者が明快）。選択の永続化は `setGuidelineAttachments(eventId, attachmentIds[])` mutation（トグルで即時保存・admin ガード・`event_line_broadcasts` 行へ upsert/delete）。
- **紐付け完了時の発火**: `handleInviteCode`（`line-webhook-handler.ts`）の CAS 成功＋reply 後に `sendGuidelinesOnLink` を await＋try/catch（typically 1-2 files=1 batch で即時。長寿命 Node サーバなので await で問題なし）。`manualLinkGroup`（`admin/line-channels/actions.ts`）の `status='linked'` 確定後も同ヘルパーを await＋try/catch。
- **DoD 補足**: `packages/shared` 変更のため全パッケージ test 対象。migration は `db:generate`→本番は `db:migrate`（main 担当）。

### 実装時の注意（要確認・取りこぼし防止）
- **[T4] `manualLinkGroup` は grep のみ済・実装前に精読すること。** `status='linked'` を2箇所（`admin/line-channels/actions.ts:244,259`＝upsert or 2分岐）でセットしている。発火には (a) `event_line_broadcasts.id`（＝選択 join のキー）、(b) `lineGroupId`、(c) `channelAccessToken` が要る。**既存 broadcast 行を再利用しているか**（新規 INSERT で id が変わると旧 join 行が孤立）を確認。招待コード未発行のまま手動紐付けする経路（＝モーダル未表示＝選択ゼロ）があるなら送信はクリーンな no-op で正しい——想定で済ませず実経路を確認する。
- **[T4] webhook で `sendGuidelinesOnLink` を await する遅延は許容。** 多ファイル選択（>5＝バッチsleep）で LINE の webhook タイムアウトに触れて再送され得るが、**再送は無害**（CAS が再link を弾く＝二重送信なし・push は webhook 応答と独立に完走）。fire-and-forget に「最適化」してエラーログを失わないよう、その旨を1行コメントで残す。
- **[T5・任意]** 紐付け成功 reply（`handleInviteCode` の「今後この大会宛の連絡を…自動配信します」）は、直前に送った要綱に触れていない。文言追記は cosmetic・任意。

## 実装タスク

### タスク1: スキーマ＋migration（共有ホットスポット・先行）
- [x] 完了
- **対応Issue:** #279（親 #278）
- **目的:** 選択保存の join テーブルと `guidelines_sent_at` 列を追加し、以降のタスクの土台を確定
- **対応AC:** AC-2, AC-6（土台）
- **主な変更領域:** `packages/shared/src/schema/event-broadcast-guideline-attachments.ts`（新規）、`event-line-broadcasts.ts`（`guidelinesSentAt` 追加）、`schema/index.ts`・`schema/relations.ts`、drizzle migration（`packages/shared` の migrations）、`docs/design/db.md`（該当セクション in-place 更新）
- **依存タスク:** なし
- **必要なテスト:** スキーマの型・制約（UNIQUE/FK cascade）はマイグレーション適用後の worktree vitest で担保（隔離テストDBへ push）。単体の新規テストは最小
- **完了条件:** `pnpm db:generate` が単一 migration を生成、`pnpm test:db:push` 相当が通る、型チェック green

### タスク2: 要綱送信ヘルパー
- [ ] 完了
- **対応Issue:** #280（親 #278）
- **目的:** 選択済み要綱を LINE グループへ push する best-effort ヘルパーを実装
- **対応AC:** AC-3, AC-4, AC-6, AC-10
- **主な変更領域:** `apps/web/src/lib/line-broadcast-guidelines.ts`（新規）＋隣接 `.test.ts`。`getOrCreateShareToken` を再利用。`line-broadcast.ts` は触らない
- **依存タスク:** タスク1
- **必要なテスト:** メッセージ形式（`📎【大会要綱】filename` + `/api/line-broadcast/attachments/[token]`）、0件で skipped、`LINE_NOTIFY_DRY_RUN=1` で実push無し、push失敗時に throw せず warn＋`guidelines_sent_at` を更新しない、複数ファイルのバッチ送信
- **完了条件:** 上記 vitest green・型チェック通過

### タスク3: 永続化＋候補ローダー＋再送 Action（events）
- [ ] 完了
- **対応Issue:** #281（親 #278）
- **目的:** モーダル用の候補提供・選択保存・要綱再送を Server Action として提供し、関連メール収集を共有化
- **対応AC:** AC-1, AC-2, AC-8, AC-9
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/actions.ts`（`generateInviteCodeForEvent` 返却拡張・`setGuidelineAttachments`・`resendGuidelines` 追加）、`apps/web/src/lib/event-related-mails.ts`（新規・`collectRelatedMailIds` 抽出）、`apps/web/src/app/(app)/events/[id]/components/EventRelatedMails.tsx`（共有ヘルパー利用に差し替え）＋各テスト
- **依存タスク:** タスク2（`resendGuidelines` が `sendGuidelinesOnLink` を呼ぶ）
- **必要なテスト:** 候補収集（3経路union・メール別・添付昇順）、`setGuidelineAttachments` の upsert/delete と再発行後保持、`resendGuidelines` がヘルパーを呼ぶ、admin/vice_admin 以外を拒否、`EventRelatedMails` 回帰
- **完了条件:** vitest green・`revalidatePath` 漏れなし・型チェック通過

### タスク4: 紐付け完了時の発火（webhook＋手動紐付け）
- [ ] 完了
- **対応Issue:** #282（親 #278）
- **目的:** `linked` 遷移の両経路で要綱送信を発火させる（best-effort）
- **対応AC:** AC-3, AC-5, AC-6, AC-7, AC-8
- **主な変更領域:** `apps/web/src/lib/line-webhook-handler.ts`（`handleInviteCode` の成功＋reply後に発火）、`apps/web/src/app/(app)/admin/line-channels/actions.ts`（`manualLinkGroup` の linked 確定後に発火）＋webhook テスト
- **依存タスク:** タスク2
- **必要なテスト:** linked 遷移で選択済み要綱が送信される、未選択なら送信されない、送信失敗しても `status='linked'` は保たれる、`manualLinkGroup` でも送信、再紐付けで再送
- **完了条件:** vitest green・既存 webhook テスト回帰なし・型チェック通過

### タスク5: UI（招待コードモーダル＋LINE配信セクション）
- [ ] 完了
- **対応Issue:** #283（親 #278）
- **目的:** モーダルの要綱選択リストと linked 表示の状態＋再送導線を実装
- **対応AC:** AC-1, AC-2（UI）, AC-13
- **主な変更領域:** `apps/web/src/components/events/InviteCodeModal.tsx`（メール別グルーピングのチェックリスト・空状態・トグルで `setGuidelineAttachments`）、`apps/web/src/components/events/LineBroadcastSection.tsx`（linked に「要綱: N件選択済み（最終送信）」＋「要綱を再送」）、`apps/web/src/app/(app)/events/[id]/page.tsx`（選択件数・`guidelines_sent_at` の server 読込と props/action 配線）
- **依存タスク:** タスク3（`setGuidelineAttachments`/`resendGuidelines`/拡張返却）
- **必要なテスト:** モーダルが候補をメール別に描画・チェックでaction呼び出し・空状態、linked 表示の件数/再送ボタン。既存プリミティブ（`ui/`）と 375px 規約に準拠。`createPortal`/`.modal-overlay-h` は既存モーダル踏襲
- **完了条件:** component テスト green・型チェック通過。`git grep DESIGN-PROTO`=0（プロトタイプ由来スタブなし）

## 実装順序（Wave = 並行実装できるタスクの組）
- Wave 1: タスク1（スキーマ／migration。共有ホットスポット・先行）
- Wave 2: タスク2（送信ヘルパー。タスク1 依存）
- Wave 3: タスク3（events actions）, タスク4（webhook＋手動紐付け）— 共にタスク2 依存・変更領域が重ならない → 並行
- Wave 4: タスク5（UI。タスク3 依存）
