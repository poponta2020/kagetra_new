---
name: feature-def-line-chat-commands
description: line-chat-commands 要件定義
type: project
---

大会別 LINE グループで Bot をメンションして「申し込みました」「振り込みました」と送ると、申込グループ内の**全開催日**の `entry_status` / `payment_status` が進む機能。要件定義完了（2026-09-07）・実装未着手。

**正典**: `docs/features/line-chat-commands/requirements.md`（AC 15件 = auto-test 14 / manual 1）と `implementation-plan.md`。実現可能性の実測は [[reference_line_webhook_mention_payload]]、調査経緯は [[project_line_bot_entry_status_feasibility]]（★遠征届の作成は当初候補だったが「メンションして呼び出してまでやることではない」とユーザー判断でスコープ外になった。あの調査メモから遠征届を復活させない）。

**確定した設計判断とその理由**
- **メンション必須** — applied への遷移は LINE 通知2通を伴い `event_lifecycle_notifications` の once-ever スロット（UNIQUE(event_id,type)）を消費する。戻しても通知は取り消されず再実行しても二度と飛ばない＝**誤爆が実質取り消せない**ため、明示的なメンションを意思表示とみなす
- **成功時は Bot が返信しない** — 既存の完了通知が同じグループに流れるので、返信を足すと1操作3通になる。返信するのは「すでに完了」「否定で判定不能」「現地払い混在で一部実行」「対象なし」「失敗」の5ケースだけ
- **否定表現を弾く** — 「申込」「振込」のような短い語を許容した結果、「まだ申し込んでません」が申込済みを引き起こす経路ができる。取り消せない操作なので安全側へ
- **申込は LINE からは admin のみ**（画面は vice_admin も可）。副管理者は会計関連＝支払のみ。`is_treasurer` は認可に使わない既存方針を維持
- **対象は常にグループ内の全開催日**（cancelled 除く）。チャット1発言には日の選択情報が乗らないため決め打つ
- **級グループ（grade_broadcast）は対象外** — 大会を特定できず構造的に載らない

**Issue**: 親 #606 / 子 #607(T1 純関数) #608(T2 lib切り出し) #609(T3 認可) #610(T4 webhook配線)。Wave 1 = T1・T2・T3 並行、Wave 2 = T4。

**★T2 は挙動不変のリファクタ**（`setEntriesApplied` のインライン実装を `lib/events/apply-entries-applied.ts` へ。`apply-payments-paid.ts` と同じ2段構成）。**コミット後 push のエラー処理の非対称性を「揃えて」はいけない** — 会計向けは throw 時に claim 済み行を failed で finalize し参加者向けは握りつぶす、という差は意図的（会計向けは文面組立が DB を引いて throw しうるため）。回帰ハーネスは既存の event-lifecycle-notify.test.ts / lifecycle-actions.test.ts を**無改変で green**。

**★実装時に踏みやすい3点**: ①`applyWebhookEvents` は `event_line_broadcasts` を読んでいないので linked + line_group_id 一致の検証は新規ルックアップが要る ②`not_applying` の日は既存 WHERE で自然に除外される＝「全開催日」を理由に WHERE を広げない ③replyToken は単発なので申込・支払の両方が返信対象なら1回の reply に複数メッセージ
