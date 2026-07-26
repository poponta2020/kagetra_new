---
name: feature-def-event-list-redesign
description: 大会申込一覧リデザイン 要件定義
type: project
---

かげとら `/events`（大会申込一覧）のリデザイン。デザイン確定（Claude Design 往復・Round 1〜5）→要件承認→Issue 作成まで完了。**実装未着手**。

## 決まったこと（設計判断と理由）

- **締切済（会内締切超過）は一覧から非表示。ただし「自分が参加回答済み(attend=true)」の行は表示継続**。本番実測で 15行中6行が締切済で先頭を占有していたのが動機。完全非表示にすると「申し込んだかの確認」導線が締切後〜開催日の間だけ消える（過去イベント一覧に入るのは開催日経過後）ため、自分の行だけ残す形で両立させた
- **色帯は藍**（`canApply && 中止でない && 締切超過でない` ＝「今申し込める」）。Round 2 のユーザー案は朱だったが、ブランド規約（参加=藍/朱=否定・警告）と逆転するため規約準拠へ反転
- **朱の用途は「本日締切」の塗りピルだけ**。Round 4 のユーザー編集で soon（3日以内）の朱をやめ数字19px（墨）のみに。緊急シグナルの希釈を防ぐ
- **参加者はチップ廃止・全員表示**。「参加 0名」は meta 行ごと非表示。チップは面積が出て大会名より目立ち、「他N名」は結局誰か分からないため
- **16px 余白は /events ページ内で完結させ `mobile-shell.tsx` は触らない**。/tournaments・/players/[id] 等は各ページが自前で `p-4` を持つため、共通シェルに入れると二重余白になる（AC-14 で auto-test 化）

## ★実装時の落とし穴

- **`design_source: claude-design` ＝ 適用できる patch は無い**。`design-mock/redesign.html` から同じトークン変数で手移植する（Path L の patch がある機能とは手順が違う）
- **モックに描かれていない状態が1つある**: 「締切済だが自分が参加回答済み」の行（締切済淡色＋砂帯＋自分を含む meta 行）。design-spec §Round 5 の記述が正
- **既存テストに新 AC と矛盾する assertion がある**（「参加 0名」表示・「他2名」・fixture の締切済イベント）。書き換えが正しく、回帰の破壊ではない。維持すべきはソート2軸・申込可能フィルタ・空表示文言・行タップ遷移
- 自分の参加判定に**新クエリを足さない** — 既存 `participantRows` の select に `userId` を足すだけで済む

## Acceptance Criteria

全16件（auto-test 15 / manual 1）。うち回帰 AC は AC-12（ソート/フィルタ/空表示）・AC-13（空表示文言）・AC-14（他ページの余白不変）の3件。

## Issue

- 親: #340 https://github.com/poponta2020/kagetra_new/issues/340
- 子: #341（純関数+型）/ #342（page.tsx データ+余白）/ #343（EventListClient UI）/ #344（忠実度+余白回帰ガード）

## Wave 構成

- Wave 1: #341（型が共有ホットスポットなので単独先行）
- Wave 2: #342 / #343（依存は #341 のみ。page.tsx と EventListClient.tsx で変更領域が直交）
- Wave 3: #344（#342・#343 完了後の検証）

## 補足

- design-spec は locked。Claude Design プロジェクト「Kagetra Design System」→ グループ「大会申込リデザイン」に `current.html`（現状再現）と `redesign.html`（確定案）
- **Claude Design へ push しただけではペインのカード一覧に出ない**ことがある（`_ds_manifest.json` の cards 配列が索引の実体）。`register_assets` で明示登録すると出る
- 前回リデザイン（PR #251・event-list-refinements）の design-spec も locked のまま併存。今回はその実装済み画面からの delta
