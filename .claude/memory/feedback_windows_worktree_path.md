---
name: feedback-windows-worktree-path
description: "Windows + Git Bash 環境では /tmp の解釈が分岐する。worktree は必ず \"C:/tmp/...\" の Windows パスで明示作成する"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a4b8164f-39e4-4441-a4be-cbf7c0ddf3f3
---

# Windows worktree のパス解決罠

`/tmp/impl-xxx` のような Unix 風パスで worktree を作ると、ツールごとに別ディレクトリを指してしまう。

- `git worktree add /tmp/impl-xxx` → `C:\Users\popon\AppData\Local\Temp\impl-xxx` （Git Bash の `/tmp`）
- `Write /tmp/impl-xxx/...` （Windows ネイティブ Node 経由）→ `C:\tmp\impl-xxx\...`
- `Bash ls /tmp/impl-xxx` → `C:\Users\popon\AppData\Local\Temp\impl-xxx` （Bash の `/tmp`）
- `pnpm` 等の Node CLI → Windows パス側を参照

結果として、Write で作ったスクリプトを pnpm が「Module not found」とエラーにする。

**Why:** PWA タスク1 で `/tmp/impl-pwa-minimal` で作成 → Write したスクリプトが pnpm から見えず、tsx 実行失敗。観察 #48 でも検知済みの罠。

**How to apply:** `/implement` 等で worktree を作成するときは、最初から Windows パスで明示する:

```bash
git worktree add "C:/tmp/impl-<summary>" -b feature/<summary> origin/main
# 以降のすべてのファイル操作も "C:/tmp/impl-<summary>/..." を使う
```

[[feedback-memory-management]] の通り、Windows + Git Bash の混在環境固有の問題なので、他環境（mac/Linux）には適用されない。
