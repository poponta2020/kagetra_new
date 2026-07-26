---
name: ship-event-detail-redesign
description: 大会申込詳細リデザイン出荷
type: project
---

PR #376 マージ完了（merge commit a08fdcb・2026-07-27）。URL: https://github.com/poponta2020/kagetra_new/pull/376
親Issue #352 クローズ・子Issue #353〜#358 は closing keyword で自動クローズ。

## 出荷内容
`/events/[id]`（大会申込詳細）を**罫線＋余白主導（脱カード）**へリデザイン。カードを使うのは関連メールの1件ずつだけになり、運営操作は `<details>`（**既定=閉**）へ。

- **申込フロー新設**（両ビュー共通・5ステップ常時描画）: 判定は純関数 `buildEntryFlow`（`lib/events/entry-flow.ts`）。done/isNow/isWarn/isGoal/neutral の**合成可能フラグ**（warn と now は併存しうる・開催は完了しても goal を保つため排他 enum にできない）
- **一般会員から参加費/支払締切/支払方法/支払情報/申込方法を隠す**（管理者トグル内へ集約）
- 進行管理=申込/支払の2トグル・LINE 配信はトグル化し非管理者に非描画・級別配信はその中の1項目へ
- 名簿=級タブ＋級の若い順・**この画面からの Excel 取込（`uploadRoster`/`RosterUploadForm`）を廃止**（メール取込経由のみ）
- 対象級を級別定員へ統合（3分岐）・日付整形を `lib/event-date` へ共通化（JST 固定）

## レビュー（4ラウンド・全て effort=high）
詳細は [[auto-review-round-pr376]]。R1 should_fix 4件 → R2 **blocker 3件** → R3 pass(nit1) → R4 クリーン pass。
**★R2 の最重要指摘 = client component 化で名簿の内部列が一般会員の RSC payload へ漏れていた**（`note`/`rawKana`/`rawDan`/`selectionOutcome`/`approvedByUserId`）。TypeScript の型は実行時に余剰プロパティを落とさないので型では防げず、DB クエリの `columns` で絞る必要があった。

## ★出荷直前に自力で防いだ CI 破壊
Codex pass 後、CI pending の状態で E2E の対象範囲を確認したところ `event-lifecycle` / `event-line-broadcast` が旧 UI 前提で**確実に赤**になる状態だった（操作ボタンが既定=閉のトグル内で not visible・廃止した表示への assertion 残存）。新 UI へ更新しローカル8件 pass を確認 → **CI green（7m50s）でマージ**。前回 PR #351 は同じ形で CI を赤にしている。

## 検証（最終）
- CI **green**（Lint / Typecheck / Test 7m50s・E2E 込み）
- Vitest 129 files / 1776 passed / 1 skipped・check-types clean・eslint clean
- **忠実度チェックリスト 12/12 を実機実測**（375px）: ページ全長 管理者 **942px**（基準1100以内）/ 会員 **759px**（基準800以内）・横スクロール0・`<details>` は admin 0/6・member 0/3 で既定=閉・`rounded-full` は申込フローの点5個のみ＝ピル0・生ISO 0件
- **AC-10/AC-28 を実サーバーの RSC payload で検証**（会員ビュー HTML 79KB を全文検索し機密 0 件）

## 残 DoD
なし（本番実機確認は出荷後に随時。不具合が出たら /quickfix・/bug-report で追修正）
