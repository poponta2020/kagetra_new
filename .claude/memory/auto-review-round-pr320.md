---
name: auto-review-round-pr320
description: auto-review PR #320
type: project
---

PR #320（fix/deploy-doc-sudoers-order）の auto-review 記録。docs のみの変更（docs/deploy/entry-overdue-alert.md §0）。

- **R1** effort=medium needs_changes should_fix=2 tokens=72,162
  - 「別 SSH セッションを開く」は退路にならない（sudoers 破損時は既存・新規どちらも sudo 不可。保持すべきは sudo -i した root shell）／live ファイルへの直接 install は部分書き込みのリスク
  - マージ前フローでは本番 checkout に unit ファイルがまだ無く、実 install は allowlist が正しくても source missing で失敗する（allowlist 不一致と誤認させる）
- **R2** effort=medium needs_changes blockers=1 nits=1 tokens=60,401
  - [B] `SRC=$(mktemp); git show ... > "$SRC"` はリダイレクトが git show より先にファイルを作るため、取得失敗時に空ファイルが残る。**空ファイルは visudo -c を通過する**ので配置すると deploy allowlist が丸ごと消える
  - [nit] 内側 sudo に -n があるので不一致でもパスワードプロンプトは出ない
- **R3** effort=medium needs_changes should_fix=3 tokens=80,760
  - git fetch は fetch.prune 無しでは削除済みブランチの remote-tracking ref を消さない → 「マージ後は git show が失敗する」は誤りで、stale ref から古い sudoers を引く方が危険
  - §3 は操作ユーザーの全権 sudo なので kagetra の allowlist 検証を兼用できない
  - auto-deploy は稼働中プロセスの足元で .next を置換するため「restart まで旧コードで安全」は断定できない（未ロードの chunk は新しいディスク内容が読まれうる）
- **R4** effort=medium **pass** tokens=77,344
- cumulative=290,667 / 500,000

## 学び
自分が書いた運用手順書は、**実際にその手順で本番作業をしてみるまで正しさが分からない**。今回は PR #312 の手順書どおりに動かした結果 3 つの実行不能・危険箇所が出て、さらにその修正版に対して Codex が 6 件の追加指摘を出した。特に「空ファイルが visudo -c を通過する」「stale remote-tracking ref」「全権 sudo では allowlist を検証できない」は、手順を書いた側の思い込みでは気づけない類。
