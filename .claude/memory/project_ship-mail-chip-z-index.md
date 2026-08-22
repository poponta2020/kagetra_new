---
name: ship-mail-chip-z-index
description: bug-fix: /mail 添付チップが sticky 検索バーの手前に描画される
type: project
---

## bug-fix: /mail 一覧の添付チップが sticky 検索バーの手前に描画される

**PR #529**（https://github.com/poponta2020/kagetra_new/pull/529・merged）／ Issue #528（CLOSED・https://github.com/poponta2020/kagetra_new/issues/528）／ 要件: docs/bugs/528-mail-list-attachment-chip-overlaps-search-bar/requirements.md

### 症状（軽微・表示のみ）
一般会員向けメール一覧 `/mail` をスクロールすると、メールカード内の**添付チップだけ**が sticky 検索バーより手前に描画され重なる。日時・大会案内/処理済みピル・件名・抜粋は正常に隠れる。

### 根本原因 ★一般化できる CSS の罠
`position: relative` は **`z-index: auto` のままではスタッキングコンテキストを作らない**。
`MailCard` のルートが `relative` だけだったため、添付チップの `relative z-10` がカードの外＝ページのコンテキストへ抜け、`/mail/page.tsx` の sticky 検索バー `sticky top-0 z-10` と **z-10 同士のタイ**になっていた。同一 z-index の positioned 要素は DOM 順で描画順が決まるので、後方のチップが手前に出る。
`<main>`（mobile-shell）は `overflow-y-auto` だけでスタッキングコンテキストを作らないため間に壁が無い。
**症状そのものが原因の証拠**: 非 positioned な要素（ピル・件名・抜粋）は構造上ヘッダーの下にしか描画されない ＝「チップだけ重なる」なら z-index 起因で確定。

### 修正
`MailCard` のルートへ `isolate`（`isolation: isolate`）を追加し、カード内の z-index をカード内へ封じ込めた（1 class 追加）。内部の overlay `z-0` < チップ `z-10` は維持されるためリンクのタップ可能性・DOM 構造は不変。
**検索バーを z-20 へ上げる対症療法は採らない** — `players/page.tsx` / `components/stats/section-tabs.tsx` が明文化する「検索バー=z-10 / タブ=z-20」慣習を維持するため（z が外へ抜ける構造も残り別の sticky で再発する）。
同じ overlay パターン（`absolute inset-0` + `relative z-10`）は repo 全体で MailCard のみ（grep 済）＝波及なし。

### 回帰テスト
- `apps/web/src/app/(app)/mail/MailCard.test.tsx` … ルートが `relative` + `isolate`／内部の overlay `z-0` < チップ `z-10`（**修正前に fail することを確認済み**）
- `apps/web/src/app/(app)/mail/page.test.tsx` … 検索バーが `sticky top-0 z-10` + `bg-canvas`（対症療法していないことの固定）
- jsdom にレイアウト・ペイントは無いため、これらは「重なりを生む条件」をクラス不変条件で固定するもの。実描画は証明できない

### レビュー・出荷
Codex 1R（initial・全差分網羅）で verdict=pass・修正コミットゼロ。model=gpt-5.6-sol / effort=low（sol 較正で medium→low）／累計 60,938 トークン。WONTFIX なし・再レビューせず修正した指摘なし。CI pending のままマージ（v0.9.0 方針）。

### ★残DoD（AC-5・未確認）
本番実機で `/mail` をスクロールし、添付チップが検索バーの**下に隠れる**ことを確認する。手順: main への push で自動デプロイ完了後 → https://new.hokudaicarta.com/mail を一般会員でログインして開く → 添付付きメールが含まれる位置までスクロール → チップがヘッダー領域で消えれば OK。
