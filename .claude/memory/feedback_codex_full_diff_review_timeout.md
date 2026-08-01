---
name: feedback-codex-full-diff-review-timeout
description: codex全差分レビューは10分上限を超える
type: feedback
---

`codex exec` の**全差分レビュー（gpt-5.6-sol / effort=high / 2,000行超）は Bash ツールの 10 分上限を超える**。前景で実行すると SIGTERM (exit 143) で落ち、結果 JSON が書かれないまま「レビュー未完了」になる。

**Why**: /auto-review-loop の initial / final フェーズは sol + high で全差分を網羅レビューするため、実測 200k トークン・10 分超（2026-08-01 PR #439 の R3 で発生）。delta フェーズ（terra / medium・数百行）は数分で終わるので問題にならない。

**How to apply**: initial / final ラウンドの `codex exec` は最初から `run_in_background: true` で起動し、完了通知を待つ（timeout は 30 分程度を指定）。delta は前景で構わない。
