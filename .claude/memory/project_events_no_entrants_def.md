---
name: feature-def-events-no-entrants
description: events-no-entrants 要件定義
type: project
---

# events-no-entrants 要件定義（2026-08-21）

親Issue **#505** / 子 #506(タスク1) #507(タスク2) #508(タスク3)。正典= docs/features/events-no-entrants/{requirements.md, implementation-plan.md}。実装未着手。

## 何を作るか
1. ボトムナビ「イベント」→「**大会**」改称。一覧まわりの見出し文言も揃える（/events-archive の h1・戻りリンク・0件文言、/events のフッターリンク・EventListClient の0件文言）。作成/編集画面とメール承認の「イベント」は Non-goal。URL パスもリネームしない。
2. `/events-no-entrants` 新設 = 「**会内締切を過ぎた時点で申込者0名だった開催日前の大会**」一覧。レイアウトは /events-archive 踏襲。

## ★調査で判明した核心（ここが要件の土台）
- ユーザーの言う「参加者がいないまま会内締切を迎えたために非表示」の正体は **`isRowVisible`**（`apps/web/src/app/(app)/events/event-list-utils.ts:99`）＝「会内締切超過 かつ 自分が attend=true でない」行を /events から隠すクライアント側フィルタ。**`not_applying` ではない** — こちらは申込グループページの管理者操作からのみ遷移し、締切トリガーの自動遷移は存在しない（呼び出し元を全 grep 済み）。
- したがって「参加者0名」の大会は**全会員から**消える。かつ開催日前は /events-archive（`eventDate < today`）にも出ない ⇒ **締切〜開催日の間だけ、どこからも辿れない**。開催日が過ぎれば archive には出る。
- この「開催日が過ぎたものは archive で見える」事実をユーザーに提示した結果、**新ページの守備範囲は開催日前に限る**と確定（一度「開催日条件を外す」指示が出たが、事実提示後に撤回された）。

## 掲載条件（4つすべて）
`eventDate >= 今日(JST)` / `internal_deadline` が過去（NULL・当日は対象外）/ `attend=true` が0名（**出欠行が無い、ではない** — 全員が不参加回答の大会も0名として載せる。seed の `createEventAttendance` は attend 既定 true なので要明示）/ `entry_status <> 'not_applying'`。開催日昇順。中止(cancelled)も条件を満たせば載せる。閲覧者によって内容が変わらない（全員同じ一覧）。

## 設計判断
- **母集団を「参加者0名」にした理由**: isRowVisible は閲覧者ごとに結果が変わる（他人が出る大会も自分には隠れる）。「申込者がいない」は attend=true が0件という全会員共通条件で表せ、サーバークエリが archive 並みに単純になる。
- **締切超過判定は二重定義しない**: SQL で `internal_deadline < today` に粗く絞り、取得後に既存 `isPastDeadline` で確定。`event-list-utils.ts` は `'use client'` を持たない純関数モジュールなので RSC から直接 import できる（lib へ移さない）。
- **カード右側は「参加 n名」→「会内締切 M/D」**: 母集団は定義上つねに0名なので「参加 0名」は情報量ゼロ。掲載理由の日付を出す。
- **ルートは兄弟パス** `/events-no-entrants`（`/events/no-entrants` にすると bottom-nav の `matches:['/events']` がセグメント境界一致で「大会」タブを光らせてしまう。/events-archive の先例に合わせタブは光らせない）。
- **ゲストは対象外**: `isGuestAllowedPath` は `default:false` の許可リストなので**追加しないことが仕様**（middleware が /403）。加えて /events 側のリンクを `isGuestRole` で非描画にし、403 へ飛ぶ導線を見せない。
- **design_required: false**: 視覚の契約が「/events-archive と同じ」で実ページが存在するため design-screen を回さない（差分はカード右側1点のみ・requirements §3.3 で規定）。

## AC / タスク
AC 22件（auto-test 21 / manual 1＝本番実機確認）。回帰ACに「isRowVisible 不変」「/events-archive の掲載条件不変」「ゲスト2タブ構成維持」を明示。
Wave1= タスク1(文言統一・bottom-nav.test.tsx の「イベント」18箇所を含む) ∥ タスク2(新ページ+テスト+page-padding.test.ts 登録+guest-access 回帰) → Wave2= タスク3(/events フッター2段化＋ゲスト非描画)。マイグレーション不要。
