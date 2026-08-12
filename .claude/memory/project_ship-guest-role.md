---
name: ship-guest-role
description: guest-role（第4ロール・ゲスト）出荷
type: project
---

# guest-role 出荷（PR #489）

**PR #489** feat(guest-role): 大会の参加登録だけができる第4のロール「ゲスト」を追加
https://github.com/poponta2020/kagetra_new/pull/489 — **merged**（merge commit 061d2ea・2026-08-12）

クローズ: 親 #480 + 子 #481〜#488（全8タスク）。migration **0057** 込み（`user_role` へ guest 追加・`registration_invite_kind` 新設・`registration_invites.kind`）。

## 何が入ったか

「サークル員だが協会への登録会が他会である人」を**出場予定者として保持できる**第4ロール。最終目的は match-tracker へ渡す母集団を会員以外へ広げることで、**連携 API は今回作っていない**。出場予定は既存の `event_attendances.attend=true` × `events.event_date` で表現済みなので、**新テーブルを作らず母集団に人を足せるようにした**のが実体。

- 入口=ゲスト用招待リンク（種別はトークン側で固定）→ 表示名・級・所属会の3項目のみ（PII は取らない）
- できること=`/events`・`/events/[id]`（出欠回答）・`/events-archive`・`/settings`（表示のみ）。ナビ2タブ・入口 `/events`・他は `/403`
- 回答条件=対象級は縛る・**会内締切は縛らない**
- 申込作業からの除外 E1〜E5（申込書 xlsx・参加費集計・申込ボード人数・督促・抽選プレフィル）
- 表示=参加者欄とホームのタイムラインにゲスト印つきで載る（人数にも含む）／「あなたの参加費」は出さない

## レビュー（/auto-review-loop）

**3ラウンド（initial + delta + final）→ cutoff(user-wontfix)。累計 1,055,830 トークン**（既定上限 500,000 を超過。R1 終了時に一度 token-budget で中断し、ユーザーの指示で継続）。effort は high → medium → high。

**修正したが再レビューしていない指摘は無い**（R3 の final が最終形をそのまま確認し、そこで出た2件は修正せず見送り決定）。CI は最終 HEAD `832108c` に対して **success**。

★**レビューで拾った最大の1件**: `'use server'` モジュールから非 async 値（`REGISTRATION_INVITE_KINDS`）を export しており **本番 build が失敗する**状態だった。型検査・lint・テストは全 green のまま build だけ落ちるので、レビューが無ければマージ後の CI で初めて発覚していた。

もう1件の実害級: **ページのゲストガードは Server Action を守らない**。`loadMoreMails` / `loadMoreTournaments` / `loadMoreRanking` / `startLineLink` は「ログイン済みなら誰でも」で、許可ページから直接呼べば会員限定データが取れた（要件 R8 が禁じていた形）。

見送り 4 件（TOCTOU 3・スコープ外の既存問題 1）の内訳と理由は [[auto-review-round-pr489]] に記録。

## ★残 DoD（本番実機確認）

ローカルでは静的解析とテストのみで検証しており、**ブラウザでの視覚確認は未実施**（design-spec を持たない機能なので忠実度ゲートの対象外）。本番デプロイ後に実機で確認すること:

1. ゲスト用招待リンクを発行 → 実際にゲスト登録して**3項目フォーム**が出るか
2. ゲストのボトムナビが**2タブ**か、ログイン直後に `/events` へ着地するか
3. 大会詳細の参加者欄と**ホームのタイムラインのゲスト印**が 375px で読めるか（チップ背景 surface-alt 上のコントラストを neutral-fg に揃えてある）
4. ゲストの設定画面が表示のみ（表示名・級・所属会＋ログアウト）になっているか
5. 会員・管理者から見た既存画面に変化が無いこと

## 実装記録

[[impl-guest-role-task1-2]]（基盤・アクセス制御）/ [[impl-guest-role-wave-a]]（タスク3-5）/ [[impl-guest-role-wave-b]]（タスク6-8・完了）/ 要件定義=[[feature-def-guest-role]]
