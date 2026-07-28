---
name: auto-review-round-pr401
description: auto-review PR #401
type: project
---

pr: 401 / title: feat(events): 大会申込一覧の開催日順ビューを月区切りにする
round: R1 のみで収束（initial → 3-x 打ち切り）

- R1: phase=initial / model=gpt-5.6-sol / effort=medium / escalated=false
  - effort 判定: review-effort.sh は 'high（差分 670 行 > 400）' を返したが、**サイズ起因の high** かつ高リスクパス非該当のため sol 較正で medium へ一段下げ（3-a.5 の initial 補正）
  - verdict=needs_changes / blockers 0 / should_fix 1 / nits 0
  - round_tokens: 119,686 / cumulative: 119,686（上限 500,000）
- 最終結果ファイル: scripts/review/output/codex-result-pr401-r2.json（verdict=cutoff / reason=user-wontfix / fixed_head=586c71b）

**ユーザー判断で見送り (WONTFIX) 1 件:**
- apps/web/src/app/(app)/events/EventListClient.tsx — 月区切りが見出しとして支援技術に公開されていない — 見出し行削除で /events から h1 が消え、月見出しも div/span のためスクリーンリーダーの見出しナビゲーションでページ名にも月セクションにも飛べない。修正案は sr-only h1 + MonthHeading を h2 化（見た目不変・5行程度）だったが、**会員100名超の身内向けアプリで読み上げ利用者が想定されないためユーザーが見送りを決定**（2026-07-28）。以降のラウンドで再掲禁止。
  ※この指摘は「他の全ページは各自 h1 を持ち /events だけ無い」という非対称を含む。将来 a11y を入れるなら最初の着手点になる。

**修正コミットなし**（修正対象として残った指摘が 0 件のため）。/fix は呼んでいない。

Codex が good_points に挙げた点: 空月セクションを出さない導出のテスト・曜日を UTC 暦日で扱いタイムゾーン依存を回避・締切日順の回帰テストと年跨ぎ/並び順の境界テスト。

PR 本文に書いたスコープ解釈（締切日順は出荷済みのまま。design-spec §2 見出しの「開催日順のみ」根拠）と意図的な規約例外（英字 AUG/SUN・日曜朱/土曜藍）はプロンプトの「## この PR 固有の確定仕様」に明記して渡したため、Codex はこれらを指摘していない。
