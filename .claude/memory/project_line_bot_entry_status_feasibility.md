---
name: project_line_bot_entry_status_feasibility
description: LINEグループでBotをメンション＋文言で申込ステータスを更新できるかの実現可能性調査（2026-09-07・実装未着手）
metadata: 
  node_type: memory
  type: project
  originSessionId: aa595c75-d4fb-45b8-b084-a367861633a1
  modified: 2026-09-07T03:29:45.711Z
---

2026-09-07 の調査。「大会グループの Bot をメンションして『申し込みました』と送ったら、Bot が `events.entry_status` を `applied` にできるか」。**結論＝技術的に可能。ただし要件定義は未実施で、実装 GO は出ていない。**

payload の実測結果は [[reference_line_webhook_mention_payload]]（isSelf・発言者特定・メンションなしでも届く、すべて実測で確認済み）。

## 再利用できる既存の配管

- `apps/web/src/app/api/webhook/line/route.ts` + `lib/line-webhook-handler.ts` — 署名検証・`destination` によるチャネル解決・**グループ内テキストの受信はすでに全部通っている**（今は6桁招待コードだけ処理し、他は意図的に無視）
- `handleInviteCode` が「グループ発言を検証して DB を更新して返信する」完成形のテンプレ。UPDATE の WHERE に事前検証時の状態を再掲する stale ガード、別グループからの実行を弾く group-mismatch ガードごと流用できる

## 成立するのは大会グループ（`event_broadcast`）だけ

`event_line_broadcasts.entry_group_id` で申込グループに紐付いているため対象大会を特定できる。`line_grade_group_bindings`（級別の常設グループ）は級としか紐付かず、**どの大会の話か決められない**ので同じ仕組みは載らない。締切リマインドが流れているのは前者なので話は噛み合う。

## 実装するなら必ず詰める3点

1. **認可を作り直す必要がある。** `setEntriesApplied` は `requireAdminSession()` で守られているが webhook にセッションは無い。グループ在籍＝権限ではない（一般会員も非会員もいる）。`source.userId → users.line_user_id → role ∈ {admin, vice_admin}` を毎回引いて fail-closed。
2. **★誤爆が取り消せない。** `applied` への遷移は LINE 通知2通（参加者向け＋会計向け）を伴う対外アクションで、`event_lifecycle_notifications` の once-ever スロット（UNIQUE(event_id,type)）を消費する。`applied=false` で戻しても通知は取り消されず、**再度 applied にしても二度と通知が飛ばない**。「間違えたら戻せばいい」が効かないのがメンション必須（または確認ステップ）の最大の根拠。
3. **どの開催日を対象にするか。** `entry_status` は大会（開催日）単位、申込グループは複数日にまたがる。画面は選択ダイアログで解決し Server Action 側で再検証しているが、チャット1発言にその情報は乗らない。「このグループの `not_applied` な大会すべて（`cancelled` 除く）」のような規則を明示的に決める必要がある。
