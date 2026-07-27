---
name: feedback-gate-dod-crlf-windows
description: gate-dod.sh は Windows CRLF で D2 と CI 委譲が壊れる
type: feedback
---

devflow の `gate-dod.sh` は Windows で **DoD 判定が壊れる**。`profile-read.py` が `print()` で出力するため
stdout が CRLF になり、`.claude/project-profile.md` から読んだ配列の**最後の要素以外に `\r` が残る**。

**Why**: `gate-dod.sh` は `gh` の出力からは `tr -d "\r"` で除去しているが、Python の出力からは除去していない。
結果 `DEVFLOW_DOCS_PATTERNS` は `"docs/\r" "CLAUDE.md\r" "apps/web/CLAUDE.md"` となり、
`case "docs/features/INDEX.md" in "docs/"$'\r'*)` がマッチせず **docs を更新しているのに D2 が FAIL** する。

実害（2026-07-28 PR #392 で判明）:
- **D2 docs更新**: docs を3ファイル更新済みなのに FAIL → 出荷ブロック
- **DEVFLOW_CI_COVERS**: `"test\r" "lint\r" "typecheck"` になるため **typecheck だけ CI 委譲され、test と lint は毎回ローカル実行**される
  （症状: A3 だけ「CI green に委譲」、A1/A2 はローカル実行 = これが正常だと誤認しやすい）
- **DEVFLOW_SRC_PATTERNS**: `apps/web/src/` と `apps/mail-worker/src/` が機能しない（`packages/shared/src/` だけ末尾なので効く）

**How to apply**:
- D2 が「src 変更があるのに docs 差分がありません」と言ったら、まず `gh pr diff <N> --name-only` で実際の差分を見る。
  docs が入っていればこのバグ。`Docs: no-change-needed` の opt-out は**使わない**（PR 本文に虚偽が残る）。`--skip-dod` で出荷し報告に明記する
- 診断は `bash -x gate-dod.sh <N> 2>trace.log` → `grep "\[ -n" trace.log` で `$'docs/\r'` を確認するのが最速
- 恒久修正は devflow 本体（poponta2020/claude-devflow）側。`profile-read.py` の出力を LF 固定にするか、
  `read_profile_array` で `tr -d "\r"` を挟む。プラグインキャッシュ直編集は更新で消えるので不可
- 対症療法として `.claude/project-profile.md` を LF に変換する手もあるが `.gitattributes` 次第で戻る
