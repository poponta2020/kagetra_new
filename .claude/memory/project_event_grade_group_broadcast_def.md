---
name: project_event_grade_group_broadcast_def
description: 新規大会の概要を級別LINEグループへ自動配信する機能の設計判断（grill-me 確定、2026-07-25）。Playwright/OAM方式を検討の末に不採用
metadata:
  type: project
---

# 新規大会 → 級別LINEグループ配信（設計確定 / 2026-07-25）

grill-me で全設計判断が確定。`/define-feature` 未実行のため要件定義書は未作成。

## 経緯：Playwright/OAM 方式を検討して不採用にした

当初の依頼は「match-tracker の札組配信と同じ仕組み（Playwright で LINE 画面を bot 操作）を kagetra_new にも」だった。調査の結果 **不採用**。

- match-tracker の実体は `line-chat-worker/`（kagetra_new と**同じ Oracle Cloud VM 上の独立 Docker 常駐ワーカー**）。LINE Official Account Manager (`chat.line.biz`) を Playwright 操作して **「予約送信」を登録するだけ**。実送信は LINE 側。`Enter` は絶対に押さない設計
- 採用理由（あちら側）: Push API はグループ人数分課金。70名 × 月20回 = 1,400通 > 無料枠200通。OAM のチャットは**無料通数の対象外・無制限**
- **1つの LINE グループに参加できる公式アカウントは1体まで**（match-tracker が Bot 10体ローテ作戦を実装後に発見した制約）

不採用の理由: ユーザーが**級ごとにLINEグループを分ける**方針へ転換したため。各グループ10名程度なら Push でも通数が収まり、既存の Bot プール／webhook／push ヘルパーがそのまま使える。match-tracker への依存も消え kagetra_new 単独で完結する。

## 確定した設計

| 項目 | 決定 |
|---|---|
| 方式 | Messaging API Push |
| 送信先 | 級別 LINE グループ 5つ（A/B/C/D/E に 1:1、各10名程度） |
| 絞り込み | `events.eligible_grades` 一致の級のみ。null/空なら全5グループ（`isGradeEligible` と同ルール） |
| Bot | **級ごとに専用チャネル5個**。既存30プールから確保し `purpose='grade_broadcast'` |
| グループ紐付け | 既存の招待コード方式を流用（管理画面で発行 → Bot 招待 → `join` webhook で groupId 捕捉 → 6桁コード発言で確定） |
| 送信タイミング | **即時**（`after()` で push）。遅延キュー・取消・時間帯ガードなし |
| 対象 | 全 `events`（会内行事含む）。配信可否チェックボックスは作らない |
| 粒度 | 送信先グループごとに1通へまとめる |
| 要綱URL | 承認フォーム（`ApprovalForm.tsx`）に「LINE告知に載せる要綱」選択を追加。既存 `getOrCreateShareToken()` の無認証60日URLを流用。添付なし（手動作成）なら行を省略 |
| 大会名 | `events.title` |
| 日付 | 既存 `formatEventDate()` |
| 締切 | `internal_deadline`（会内締切）。未設定なら行ごと省略 |
| 冪等性 | 1大会1回のみ。`event_lifecycle_notifications` の once-ever 型を流用 |

スコープ外: 送信後の編集追随 / 級グループ未加入会員への到達 / 既存の大会別グループ配信との統合。

## 文面（ユーザー指定）

```
8/15(土) 大阪ABの案内が来ました！
https://…/api/line-broadcast/attachments/{token}

締切 は7/25です。
```

複数件が同じ級グループにまとまる場合は区切り線で連結。会内行事も同文面で統一（`events` に大会/行事の判別カラムが無いため）。

## 実装に効く既存資産（調査済み）

- **要綱の公開URL は既存**: `getOrCreateShareToken()`（`attachment-image-render.ts:237`）→ `/api/line-broadcast/attachments/{token}`。32文字ランダム・60日TTL・**無認証**（`middleware.ts:91` で matcher 除外＝意図的）
- **「大阪AB」形式は `events.title` が既に持つ**: `composeTitle(short_name_stem, eligible_grades)`（`apps/mail-worker/src/classify/title.ts:16`）が A→E 固定順で連結し、承認フォームの初期値になる。系列マスタ（`tournament_series.short_name`）を辿る必要はない
- **`8/15(土)` 形式**: `formatEventDate()`（`apps/web/src/app/(app)/events/event-list-utils.ts:54`）。`lib/jst-date.ts` には無い
- **`events` の INSERT は3箇所のみ**: `events/new/page.tsx:41`（手動）、`admin/mail-inbox/actions.ts:73`（承認）、同 `:413`（分割承認）
- **`events.status` は draft 廃止済みで作成即 `published`** — 下書きで止める段階が無いので誤爆ガードは別途必要（今回は即時送信を選択＝ガード無しを受容）
- 添付の選択保存は `event_broadcast_guideline_attachments`（`event_line_broadcasts` にぶら下がる）。**新規登録時点では存在しない**ため今回は承認フォーム側で選ぶ

## 通数の根拠（Bot を級ごとに分けた理由）

無料枠は **チャネル（公式アカウント）ごとに月200通**。Bot 1個を全級グループに入れると5グループ合計で月200通＝10名グループなら月20回で打ち止め。級ごとに分ければ各級200通（各級20回/月）で実質詰まらない。超過時は静かに送信不能になる点はユーザーが受容済み（「収まらなかったら手動対応する」）。

## 留意点（ユーザーへ伝達済み）

- 公式アカウントをグループに招待すると、**そのグループ内の会員の発言が OAM 管理画面から全部読める**ようになる
- 級グループ計50名程度に対し会員は100名超 → **LINE通知が届かない会員が半数近くいる**
- 1つの大会について「級グループへ概要（新機能）」と「大会別一時グループへメール全文（既存 event-line-broadcast）」の2系統が併走する。読み手が違う（会員全体 vs 申込者）ため重複ではない

関連: [[project_tournament_series_master]] / [[impl_broadcast_guidelines_on_link]] / [[project_mail_triage_badge]]
