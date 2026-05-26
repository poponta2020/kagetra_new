---
name: sticky-mobile-shell-spec
description: モバイルシェル固定（AppBar/BottomNav）。実装+テスト完了 (feature/sticky-mobile-shell, 08d2071+fdb2074)。PR 未作成、残り実機確認のみ
metadata: 
  node_type: memory
  type: project
  originSessionId: e4d39039-94be-4989-81a6-33d5c5a88188
---

モバイル (iPhone Safari / PWA standalone) でスクロール中も AppBar (44px) と BottomNav (52px) を画面端に固定する機能。要件定義書・実装手順書とも `docs/features/sticky-mobile-shell/` に保存済み、Issue #50 (親) / #51 (実装) / #52 (テスト) / #53 (実機確認) を作成。worktree `C:/tmp/impl-sticky-mobile-shell`、ブランチ `feature/sticky-mobile-shell`。

**Why:** [[project_pwa_minimal]] (PR #49) ship 後の追加改善要望。現状の MobileShell は `min-h-screen` でコンテンツが viewport を超えると body 全体スクロールしてしまい、コメントの「sticky 44px/52px」が実装と乖離していた。

**How to apply:** 実装は 1 PR で完結する小規模変更。
- [x] タスク1（#51, commit 08d2071）: `layout.tsx` に `viewportFit: 'cover'`、`mobile-shell.tsx` を `h-screen h-dvh` ベース、`bottom-nav.tsx` に safe-area padding の 3 ファイル一括コミット
- [x] タスク2（#52, commit fdb2074）: `mobile-shell.test.tsx` 5 ケース新規 + `bottom-nav.test.tsx` に padding 検証 1 ケース追加（vitest 22ファイル/180ケース全 pass）。BottomNav の safe-area padding は当初 `style={{ paddingBottom: 'env(...)' }}` だったが、jsdom CSSOM が env() を弾く問題で Tailwind arbitrary value `pb-[env(safe-area-inset-bottom)]` に変更（[[jsdom-drops-css-env-inline-style]]）。実機挙動は等価
- [ ] タスク3（#53）: iPhone Safari + PWA standalone 実機確認（Claude 側不能、ユーザー実施。PR マージ後の DoD として処理）

**次のアクション:** `/prepare-pr feature/sticky-mobile-shell` で PR 作成 → auto-review-loop → ユーザー実機確認 → `/ship`。

**注意点:** `apps/web/src/app/(app)/events/[id]/page.tsx:331` に `sticky bottom-0` の出欠トグルが既にある。今回の修正で body スクロール→main スクロールに変わるため、この sticky の文脈が変わる（むしろ BottomNav と重ならなくなる想定だが目視確認必須）。
