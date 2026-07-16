---
name: impl-broadcast-guidelines-on-link
description: broadcast-guidelines-on-link 出荷(PR #284)。大会LINE紐付け完了時に選択済み要綱を自動push
metadata:
  type: ship
---

# broadcast-guidelines-on-link 出荷完了（PR #284・2026-07-16）

大会LINEグループ紐付け完了時に、招待コードモーダルで選択した要綱ファイル（案内メール添付）を自動 push する機能。全5タスク実装。PR https://github.com/poponta2020/kagetra_new/pull/284 。親 #278 / 子 #279-283（PR 本文 closing keyword でマージ時クローズ）。

## タスクとコミット
- T1(#279): join `event_broadcast_guideline_attachments`（両FK ON DELETE CASCADE・UNIQUE(broadcast,attachment)・mail_attachment_id 索引）＋ `event_line_broadcasts.guidelines_sent_at`。migration 0039/0040。
- T2(#280): `apps/web/src/lib/line-broadcast-guidelines.ts` `sendGuidelinesOnLink`。best-effort（throw しない・全通配信時のみ guidelines_sent_at CAS 更新）。`line-broadcast.ts` を import せず自己完結の最小 push（DRY_RUN/5通バッチ/1.5s/429/30s）＋ `getOrCreateShareToken` 再利用。**送信直前に binding 再検証**（status=linked かつ lineGroupId/channelAccessToken 一致でなければ skip=binding_changed）。
- T3(#281): `event-related-mails.ts`（collectRelatedMailIds 抽出＋loadGuidelineCandidates/loadSelectedGuidelineAttachmentIds）。generateInviteCodeForEvent 返却拡張（候補読取は予約 tx 外）＋再発行時 guidelines_sent_at リセット。**setGuidelineAttachments は FOR UPDATE で紐付け遷移と直列化**（invite_pending/joined_waiting_code のみ許可・linked後は拒否）。resendGuidelines。
- T4(#282): webhook handleInviteCode の CAS 成功＋reply 後に await 発火（tx 外）／manualLinkGroup の commit 後に発火（失敗は console ログ=AC-6）。docs/spec/notifications.md 更新。
- T5(#283): InviteCodeModal（メール別チェックリスト・空状態・トグル即時保存・保存中 disable）／LineBroadcastSection（要綱 N件＋再送）／page.tsx（count集計・配線）。**task-implementer(sonnet) 委譲・受け入れ確認 green**。

## レビュー（auto-review-loop・全 effort=high）
6ラウンドで収束（verdict=pass）。累計 Codex ~713k トークン（既定500k 超過。各ラウンド実指摘で継続）。R1:未使用import/選択トグルレース、R2:偽陽性(page.tsx履歴依存)、R3:linked後編集拒否/手動紐付けログ、R4:setGuidelineAttachments TOCTOU→FOR UPDATE、R5:送信直前 binding 再検証/FK索引、R6:pass。★Codex は typecheck が green でも CI-break blocker を偽陽性で出すことがある（optional prop 見落とし・noUnusedLocals 誤仮定）——実証(grep/typecheck)で真偽確認してから対応。

## 設計要点（再訪時）
- **join-key 同一性**: event_id UNIQUE＋行再利用で setGuidelineAttachments(eventId 引き) と発火(candidate.id) は必ず同一行 → 選択保持(AC-2/AC-8)。
- **AC-6 ログ**: webhook は構造化 logger、manualLinkGroup は console.warn/error（mail-inbox の broadcast 失敗と同じ既存規約）。
- 関連 feedback: [[feedback_shared_test_db_worktree_push_race]] [[feedback_node_import_breaks_client_bundle]] [[feedback_admin_delete_for_update_race]]。

## 検証・既知事象
型チェック(全4pkg)/lint green・DESIGN-PROTO 0。実装時に web 全1154 passed。**セッション後半に vitest ワーカーが V8 ヒープ OOM 頻発**（連続実行のメモリ累積。line-channels 全4テスト同時実行で再現・個別実行では全 green）→ 隔離 test DB `kagetra_test_bgol` 使用。AC-13(実機)は出荷後確認。CI は pending のままマージ（v0.9.0・赤なら追修正）。
