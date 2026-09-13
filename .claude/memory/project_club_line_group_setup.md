---
name: club-line-group-setup
description: 会 LINE グループ設定の本番完了（2026-09-13）
type: project
---

S3「会 LINE グループ設定」を本番で完了させた記録（2026-09-13）。

## 確定した設定（club_line_groups id=1）

| 項目 | 値 |
|---|---|
| Bot | line_channels #31 = `@850jhxpv` / note=kagetra-event-bot-30 / LINE 表示名=**北大エナガ** |
| Bot の purpose/status | `club_chat` / `assigned`（プール 20→19 個） |
| OAM アカウントパス | `Uce868b2166a576e04a6a7689720101dd` |
| OAM ルーム ID | `C671544f0f9fe7a643afd562e783e02a4` |
| グループ表示名 | `【会連絡用】北海道大学かるた会`（78 名） |
| webhook グループ ID | `C4a5fe403212611daef02b1e96f075ae3`（2026-09-13 23:37 JST 捕捉） |

## ★ハマった点と正しい順序

**join webhook は `club_line_groups` の行が既に在り、かつ Bot の purpose が `club_chat` でないと空振りする。**
`handleClubChatJoin` は `UPDATE ... WHERE line_channel_id = ?` なので行が無ければ 0 行更新。
さらに webhook のチャネル解決は `purpose IN ('event_broadcast','grade_broadcast','club_chat')` で、
`club_chat` に転換していないと club 用ディスパッチに入らない。
→ **正しい順序は「画面で保存（Bot 転換＋行作成）→ Bot を退出→再招待」**。
runbook の手順どおり先に招待すると必ず 1 回空振りし、退出→再招待のやり直しになる。発言は不要（join だけで取れる）。

## ★OAM の ID は Messaging API の ID と別体系（2 か所とも）

- ルーム: OAM `C671544f…` ≠ webhook `C4a5fe40…`（要件定義書に明記あり）
- **アカウント: OAM `Uce868b2…` ≠ Bot の userId `U29ac7e62…`（= webhook destination）**。
  後者は要件定義書に書かれておらず、`webhook_destination_id` と突合して「別アカウントだ」と誤診した。
  OAM の URL は OAM から実際にコピーした値がそのまま正で、Messaging API 側の ID と照合してはいけない。

## 検証済み（本番実測）

- メンション解決: LINE 連携済み 7 名**全員**が `GET /v2/bot/group/{groupId}/member/{userId}` で 200＋表示名を返す
  （みお / 土居 悠太 / じょー / 壮吾 / minami / みのる / 佑樹）
- ワーカー API: `GET /api/line-chat-worker/tasks` が 200 `[]`（設定済み・タスク 0 件）
- グループ名は LINE API の `groupName` から取得して `chat_room_name` に設定（手入力せず）。末尾の人数カッコ混入なし

## 残り

VM の `/home/ubuntu/line-chat-worker`（git 管理でなく scp 配置・稼働中）を PR #1553 のコードへ更新し、
`.env` に `APPS_JSON` を入れて再起動する。match-tracker の本番配信も同じコンテナなので影響範囲に注意。
関連: [[ship-renewal-production-rollout]]
