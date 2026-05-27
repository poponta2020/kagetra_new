---
name: sticky-mobile-shell-spec
description: モバイルシェル固定（AppBar/BottomNav）。PR #64 + #66 + #67 (border-box fix) ship、PR #67 本番反映待ち + 実機再々確認 #53 のみ
metadata: 
  node_type: memory
  type: project
  originSessionId: e4d39039-94be-4989-81a6-33d5c5a88188
---

モバイル (iPhone Safari / PWA standalone) でスクロール中も AppBar (44px) と BottomNav (52px) を画面端に固定する機能。要件定義書・実装手順書とも `docs/features/sticky-mobile-shell/` に保存済み。

- PR: **#64** (`feat(mobile-shell): モバイルシェル固定（h-dvh + safe-area padding）`)、merge commit `cdba79d`
- 本番反映: 2026-05-26 14:05 UTC、`new.hokudaicarta.com` で HTTPS 307 / signin 200 / manifest 200 / `/hono-api/health` ok を確認、`kagetra-web.service` active (PID 954409, 85.7M)
- 残: #53 (iPhone 実機確認) のみ open、親 Issue #50 も #53 残のため open

**Why:** [[project_pwa_minimal]] (PR #49) ship 後の追加改善要望。現状の MobileShell は `min-h-screen` でコンテンツが viewport を超えると body 全体スクロールしてしまい、コメントの「sticky 44px/52px」が実装と乖離していた。

**How to apply:**
- [x] タスク1（#51, commit 08d2071）: `layout.tsx` に `viewportFit: 'cover'`、`mobile-shell.tsx` を `h-screen h-dvh` ベース、`bottom-nav.tsx` に safe-area padding の 3 ファイル一括コミット
- [x] タスク2（#52, commit fdb2074）: `mobile-shell.test.tsx` 5 ケース新規 + `bottom-nav.test.tsx` に padding 検証 1 ケース追加（vitest 22ファイル/180ケース全 pass）。BottomNav の safe-area padding は当初 `style={{ paddingBottom: 'env(...)' }}` だったが、jsdom CSSOM が env() を弾く問題で Tailwind arbitrary value `pb-[env(safe-area-inset-bottom)]` に変更（[[jsdom-drops-css-env-inline-style]]）。実機挙動は等価
- [x] Codex R1 pass + nit 反映 (bcd7f2c, mobile-shell.tsx のコメント表現を class 属性順依存ではなく cascade 表現に)
- [x] /ship 64 で merge + worktree 削除 + ローカルブランチ削除 + memory/worklog 同期 commit (030c7fa, 04db536)
- [x] 本番反映 (2026-05-26): ssh → git pull → pnpm install → pnpm build → .next/static + public/ cp → systemctl restart → health check OK
- [x] **PR #66 (min-h-0 fix, merge `6b980f2`)**: PR #64 後の実機検証で下スクロール時 BottomNav が画面外消失 → 原因は flex item デフォルト `min-height: auto` で `<main>` が shell 突き抜け、body スクロール化 → `<main>` を `flex-1 min-h-0 overflow-y-auto` に修正、テスト + requirements も同期。Codex R1 pass (29539 tokens)。汎用知見は [[flex-overflow-needs-min-h-0]] に切り出し
- [x] **PR #67 (border-box height fix, merge `69c64b0`)**: PR #66 本番反映後の実機検証で「タブが画面下端からだいぶ下に見切れる」現象。原因は Tailwind default `box-sizing: border-box` で `min-h-[52px]` の中に `pb-[env(safe-area-inset-bottom)]` (~34px) が算入されてコンテンツ領域 18px に圧縮 → `<nav>` を `min-h-[calc(52px_+_env(safe-area-inset-bottom))]` に修正。Codex R1 で **blocker (Tailwind arbitrary value 内 `+` 周辺に `_` が必要)** を指摘 → /fix で R2 pass (累計 61559 tokens)。汎用知見は [[tailwind-min-h-includes-padding-border-box]] と [[tailwind-arbitrary-needs-underscore-for-space]] に切り出し
- [ ] タスク3（#53）: PR #67 本番反映後に iPhone Safari + PWA standalone 実機再々確認（Claude 側不能、ユーザー実施）— OK なら `gh issue close 53 50`

**注意点:** `apps/web/src/app/(app)/events/[id]/page.tsx:331` に `sticky bottom-0` の出欠トグルが既にある。今回の修正で body スクロール→main スクロールに変わるため、この sticky の文脈が変わる（むしろ BottomNav と重ならなくなる想定だが目視確認必須）。
