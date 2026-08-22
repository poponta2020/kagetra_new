---
name: impl-events-no-entrants
description: events-no-entrants 実装(タスク1-3)
type: project
---

events-no-entrants の実装（タスク1-3・Wave 1: T1+T2 / Wave 2: T3）。worktree=C:/tmp/impl-events-no-entrants・ブランチ feature/events-no-entrants。

## 実装内容
- タスク1 (8842bb1, Refs #506): ボトムナビ タブ2 を「イベント」→「大会」。/events-archive の h1・戻りリンク・0件文言、/events フッターの archive リンク、EventListClient の 0件文言も「大会」へ。href・active 判定・URL パスは不変。apps/web/CLAUDE.md のルート構成も更新。
- タスク2 (b586fea, Refs #507): `/events-no-entrants` 新設（RSC・/events-archive と同型）。SQL で eventDate>=today / internal_deadline IS NOT NULL / < today / entry_status<>not_applying を粗く絞り、取得後に `isPastDeadline` で確定（しきい値を二重定義しない）。参加者判定は候補 ID スコープの `selectDistinct(eventId)` 1 クエリで、結果に現れない ID を 0 名とする。カード右は「参加 n名」でなく `会内締切 {formatFlowDate}`。
- タスク3 (f38e159, Refs #508): /events フッターを 2 段化し 2 段目に「申込者なしで締切済 →」。`isGuestRole(session?.user.role)` でゲストには非描画。

## 委譲と受け入れ
- タスク1 のみ devflow:task-implementer (sonnet) へ委譲。18 箇所の文言追随＋AC-15/AC-18 テスト追加まで正確。受け入れ確認で差分全読み・矛盾なし。タスク2・3 は main が直接実装。
- Wave 1 の排他は成立（T1=events/・bottom-nav・CLAUDE.md、T2=events-no-entrants/・page-padding・guest-access）。**apps/web/CLAUDE.md の 1 行が両者の潜在ホットスポット**だったので、事前に「言い換え＋新ページ追記の両方を T1 が担当」と割り当てて衝突を回避した。

## 注意点・環境
- events/page.tsx と page.test.tsx は T1 と T3 の変更が同一ファイルに乗るため、コミット分割時に T3 分を一時退避→T1 コミット→復元→T3 コミット の手順で切り分けた。
- **ローカルテスト未実行**: Docker Desktop が起動せず（docker ps がタイムアウト）テスト DB 127.0.0.1:5434 に到達できなかった。vitest は global-setup で毎回 drizzle-kit push するため DB 無しでは 1 件も走らない。typecheck (tsc --noEmit) は通過。lint は eslint が 5 分でタイムアウトし未完（CI に委譲）。
- StatusPill は `published` で **何も描画しない**（中止・終了のみピル）。AC-11 のピル検証は status=cancelled で書いた。
- page-padding.test.ts は `^  return \($` が **ちょうど 1 本**であることを要求する。新ページは早期 return もローカルサブコンポーネントも作らず、0 件はインライン三項で書く必要がある。コメント中の「14 ページ」も 15 へ更新済み。
