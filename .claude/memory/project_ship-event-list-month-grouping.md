---
name: ship-event-list-month-grouping
description: 大会申込一覧 月区切り 出荷
type: project
---

**PR #401** — feat(events): 大会申込一覧の開催日順ビューを月区切りにする
https://github.com/poponta2020/kagetra_new/pull/401 — **merged** (merge commit 133a955・2026-07-28)。対応 Issue なし（純UI＝design-spec が要件成果物のため /define-feature を通していない）。

**出荷内容**: /events の開催日順ビューを開催月ごとのセクションへ。月見出し（ゼロ埋め2桁＋英字月名＋藍太罫2.5px・件数表記なし・西暦は年が変わる最初の見出しのみ）／行頭の日付ブロック（日数字ゼロなし＋英字曜日・日曜朱/土曜藍/平日淡墨）／申込可否の二重符号（3px色帯＋大会名の太さ）／ページ見出し行を削除しリスト末尾のフッター行へ移設。純関数 formatEventDay・groupEventsByMonth を追加。正典= [impl_event_list_month_grouping.md](impl_event_list_month_grouping.md)（実装詳細・検証手順）。

**レビュー**: /auto-review-loop 1R のみで収束（initial・gpt-5.6-sol・effort=medium）。blockers 0 / should_fix 1 / nits 0、累計 119,686 tokens。**修正コミットなし**＝「修正したが再レビューしていない指摘」はゼロ（CI が赤くなった場合の手がかりとしての未確認差分は無い）。

**★ユーザー判断で見送った指摘 (WONTFIX) 1件 — 将来の宿題**: /events から h1 が完全に消えた（見出し行を削除したため）。このアプリのシェルは h1 を持たず**他の全ページは各自 h1 を持つので /events だけが無い**非対称状態。月見出しも div/span でスクリーンリーダーの見出しナビゲーションから辿れない。修正案は sr-only h1 +ffMonthHeading を h2 化（見た目不変・5行程度）だったが、身内向けアプリで読み上げ利用者が想定されないためユーザーが見送りを決定。**a11y に着手するならここが最初の一手**。

**残 DoD**: 本番実機確認（375px で月見出し・日付ブロック・フッター行）。CI は pending のままマージ（v0.9.0 方針）— 赤くなったら /quickfix で追修正。

**出荷時の詰まりどころ（次回の短縮用）**: ship-finalize.sh が merged=already を返しリモートブランチを消さなかった→手動 git push --delete。worktree 削除も失敗し .git だけ消えた半端な状態に→ remove-worktree.sh は not-a-repo で無力。残骸は node_modules の深いパスで Remove-Item が MAX_PATH に当たるため **robocopy /MIR で空ディレクトリをミラー**して削除した（reparse point 0 件を確認してから実行）。さらに main の ff-merge が /design-screen 由来の untracked な docs/features/<slug>/ に阻まれた（PR で tracked になったため）→ origin/main と内容比較して安全確認のうえ削除してから ff。
