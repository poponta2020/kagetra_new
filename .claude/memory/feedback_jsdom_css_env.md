---
name: jsdom-drops-css-env-inline-style
description: jsdom (vitest/jest) は React の inline style に env() があると CSSOM 経由で全て捨てる。Tailwind arbitrary value を使え
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb28a9ba-379a-4a6a-b704-e7d79919d95d
---

React の `style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}` を jsdom で render すると、`getAttribute('style')` は **null**、`outerHTML` にも style 属性は出力されない。jsdom の CSSOM パーサーが `env()` を invalid value と判定して style 全体を捨てる挙動。

**Why:** sticky-mobile-shell (PR `feature/sticky-mobile-shell`) のタスク2 で BottomNav の safe-area padding をテスト検証しようとして発覚。実機 (Chrome/Safari) では env() は valid なので動くが、vitest 環境では検証不能。

**How to apply:**
- env() / 将来 var(--xxx) などの CSS 関数値を inline style で書く必要が出たら、まず Tailwind arbitrary value (`pb-[env(safe-area-inset-bottom)]`) を検討する
- どうしても inline style にする場合は、検証を class 名や React props 経由（react-test-renderer 等）に切り替えるか、実機/Playwright に委ねる
- jsdom 25 で確認した挙動。アップグレードで直る可能性は低い（CSS Houdini 互換が要件）

参照: [[sticky-mobile-shell-spec]] のタスク2 完了時に commit fdb2074 で inline style → `pb-[env(safe-area-inset-bottom)]` に切り替え
