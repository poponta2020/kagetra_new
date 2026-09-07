---
name: reference_line_webhook_mention_payload
description: LINE webhook のグループ内メンション payload 実測結果（isSelf・発言者特定・メンションなしでも届く）
metadata: 
  node_type: memory
  type: reference
  originSessionId: aa595c75-d4fb-45b8-b084-a367861633a1
  modified: 2026-09-07T03:29:12.279Z
---

2026-09-07 に本番 Bot（`line_channels.id=12` / `@600txdhj`・available で未紐付け）を検証用グループへ入れて実測した、LINE Messaging API webhook の **グループ内メンション payload の実体**。「Bot をメンションして『申し込みました』と送ったら申込ステータスを更新できるか」の実現可能性調査（[[project_line_bot_entry_status_feasibility]]）で取得。

計測は一時ログ（PR #593 で投入 → PR #603 で撤去）。ログ本体はもう存在しないので、**この結果が唯一の記録**。

## 実測結果（3パターン送信）

| 送ったもの | `textLength` | `mention` |
|---|---|---|
| `@Bot 申し込みました`（メンション先頭） | 14 | `{"mentionees":[{"index":0,"length":6,"userId":"U…","type":"user","isSelf":true}]}` |
| `申し込みました @Bot`（メンション末尾） | 14 | 同上で `index:8` |
| `申し込みました`（メンションなし） | 7 | `null` |

分かったこと:

1. **`isSelf: true` が実際に付いてくる。** Bot 自身へのメンション判定は mentionee 1個見れば済む。
2. **mentionee の `userId` は `line_channels.webhook_destination_id` と一致する。** `isSelf` に依存しない判定経路も同時に成立（実測で照合済み）。
3. **`source.userId` は `users.line_user_id` と突合できる。** 発言者を会員として一意に解決でき、`role` まで引ける＝認可判定の材料になる（LINE Login チャネルと Bot チャネルの userId 空間が同一である裏取りにもなっている）。
4. **メンションなしのテキストも webhook に届く。** メンションは誤爆防止の設計選択であって、受信の前提条件ではない。
5. **テキスト本文にはメンション文字列がそのまま含まれる**（`index`/`length` がその範囲）。文言マッチするならメンション部分を除去してから判定する必要がある。
6. LINE アプリの `@` 候補に Bot は出る（`length:6` = `@`+表示名5文字。手打ちの `@600txdhj` なら9文字になるはずで、そうなっていない＝ピッカーから選択されている）。

## 再実測したくなったときの手順

1. `line_channels` で `status='available'` かつ `event_line_broadcasts` に active 行が無い Bot を選ぶ。**`handleJoin` は `WHERE line_channel_id=? AND status='invite_pending'` にグループ条件が無い**ので、招待コード発行済み（Bot 招待待ち）の Bot を使うと**実運用の紐付けがテストグループへ向け替わる**
2. `applyWebhookEvents` の「招待コード以外のテキスト」分岐にログを1本足す（本文は出さず長さのみ。実運用グループの雑談を journalctl に残さないため）
3. 本番 web は docker ではなく systemd: `sudo journalctl -u kagetra-web.service --since "30 min ago" -o cat | grep -F "<event 名>"`
