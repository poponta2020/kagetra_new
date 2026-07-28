---
name: auto-review-round-pr402
description: auto-review PR #402
type: project
---

pr: 402 / title: fix(events): 月見出しをスクロール追従させ、既定ソートを開催日順にする
round: R1 のみで収束（initial で verdict=pass。final は省略＝R1 が最終形を見ている）

- R1: phase=initial / model=gpt-5.6-sol / effort=low / escalated=false
  - effort 判定: review-effort.sh は 'medium（high/low いずれにも非該当・210行/2ファイル）' を返し、initial の sol 較正で **low** へ一段下げ
  - verdict=**pass** / blockers 0 / should_fix 0 / nits 0
  - round_tokens: 71,948 / cumulative: 71,948（上限 500,000）
- 結果ファイル: scripts/review/output/codex-result-pr402-r1.json（HEAD=311ef5d）
- **修正コミットなし・WONTFIX なし**＝「修正したが再レビューしていない指摘」ゼロ

Codex の good_points: 既定ソート変更に伴うテスト更新の網羅（ソート/フィルタ/月区切り/締切表示/DOM順）、sticky に top-0・背景・z-index・上余白をまとめて設定し透過と重なりを防いでいる点、締切日順へ切り替えるとフラット表示へ戻り開催日順へ戻せることのテスト。

プロンプトに渡した前提: MobileShell の <main> がスクロールコンテナで上部バーが無いため top-0 にオフセット不要であること、SensekiTimeline の先例、pt-2 と gap 14→6px がセットであること、PR #401 で確定した意図的例外（英字・日曜朱/土曜藍・締切日順は出荷済みのまま・月見出しの h2 化見送り）の再掲禁止。
