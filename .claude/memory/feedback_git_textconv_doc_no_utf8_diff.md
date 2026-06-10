---
name: feedback_git_textconv_doc_no_utf8_diff
description: Git for Windows の astextplain textconv が .doc/.pdf 入り diff を非UTF-8化し codex 等の stdin パイプが壊れる。--no-textconv で生成する
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 28823bb7-31e0-47fa-8098-7592e1e9419b
---

`git diff` で .doc/.pdf を含む差分を作ると、Git for Windows のシステム gitattributes（`astextplain` textconv ドライバ）が変換を試み、diff に非 UTF-8 バイトが混入することがある（antiword の "I'm afraid the text stream of this file is too small to handle" が前兆）。`codex exec` は stdin が invalid UTF-8 だと API 呼び出し前に exit 1 で拒否する。

**Why:** PR #134（.doc fixture 入り）の /auto-review-loop R1 で codex が diff を読めず失敗した（トークン消費はゼロで実害は再実行のみ）。

**How to apply:** ツールへパイプする diff は `git diff --no-textconv` で生成する。バイナリは "Binary files ... differ" の 1 行に収まり UTF-8 クリーンになる。/auto-review-loop の 3-a で .doc/.pdf 等のバイナリを含む PR を扱うときは必ずこの形。
