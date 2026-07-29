---
name: impl-roster-file-adoption
description: roster-file-adoption 実装完了
type: project
---

roster-file-adoption（親Issue #403 / 子 #404-#408）を worktree `C:/tmp/impl-roster-file-adoption`（branch feature/roster-file-adoption）で全5タスク実装。名簿をパースせず原本ファイルのまま採用する導線。

## 実装内容とコミット
- c377506 タスク1（main 直実装）: `tournament_entry_roster_files` 新設 + migration 0051。`tournament_entry_rosters` を拡張しない判断が肝 — entries 0 件の行を混ぜると /dashboard の「確定名簿があれば entries から出場者、無ければ出欠へフォールバック」が壊れて「出場者0人」になる。UNIQUE(source_attachment_id) で二重採用を DB 制約で禁止。entry_group_id=RESTRICT / source_attachment_id=CASCADE。
- e643353 タスク2（task-implementer 委譲）: adoptRosterFile / releaseRosterFile + メール詳細の採用 UI（RosterFileAdoptSheet）。
- 21655e1 タスク3（task-implementer 委譲）: 会員向けビューア /roster-files/[id] + /api/roster-files/[id]{,/preview/[page]}。認可は loadAdoptedRosterFile 1本（fail-closed）。
- 26cb6e9 タスク4（task-implementer 委譲）: 大会詳細 RosterSection のファイル表示。
- f960989 タスク5（main 直実装）: /admin/entries の hasConfirmedRoster を「パース済み ∪ confirmed のファイル採用」へ拡張。entry-board-utils.ts は無変更。

## Wave 構成と委譲の結果
Wave1=タスク1（main）、Wave2=タスク2/3/4 を task-implementer 3体並行（max_workers:3 に合わせタスク5は Wave から外して main がバリア後に直列実装）。排他宣言ミス・ファイル衝突はゼロ。バリア後の受け入れで main が直した点は3つだけ:
1. `toBeDisabled`（jest-dom マッチャ）が本プロジェクトに無く check-types が落ちた → `.disabled === true` へ。
2. ワーカーが JST 日付変換を `new Date(toLocaleString("en-US"))` で自作 → 正典 `todayInJst(date)`（`lib/jst-date.ts`。Date 引数を取れる）へ置換。
3. RosterSection の折りたたみ見出し `aux` が、原本ファイルだけ採用済みの種別でも「未取込」と出ていた → `原本N件` を出すよう countLabel を拡張（見出しだけ見て「まだ何も無い」と誤読されると本機能の意味が消えるため）。

## ★ワーカーが見つけた実バグ（main が引き取って修正・タスク2コミットに同梱）
`deleteGroupIfEmpty`（apps/web/src/lib/entry-groups.ts）が新テーブルを知らず、entry_group_id の RESTRICT FK で「events 0件・採用ファイル1件」のグループ削除が FK 違反 → 呼び出し元トランザクション全体がロールバックする経路があった。既存の tournament_entry_rosters チェックと同型のガードを追加し、entry-groups.sql.test.ts に回帰テストを足した。**新テーブルに entry_group_id RESTRICT を足すときは deleteGroupIfEmpty を必ず一緒に直す。**

## 検証
check-types 全4パッケージ green / lint green / shared 8ファイル45件 green / web 167ファイル2353件 green（--no-file-parallelism）。

## 出荷後の残作業（AC-13。/ship で必ず消化）
1. 本番メール詳細から滞留中の3添付を確定名簿として採用: 添付316（E級・D級クラス分け.xlsx, mail 251）/ 添付318・319（秋田大会 参加者一覧・参加費一覧, mail 253/254 → event 21 秋田DE）
2. /admin/entries で該当大会が「名簿確定・要振込」へ移り、/events/[id] に原本が出ることを実機確認
3. ★出荷まで名簿ドラフト #1〜#3 を却下しないこと（却下すると同じ添付を再解析できなくなる既知バグ。修正は本機能の Non-goals＝別 quickfix）
