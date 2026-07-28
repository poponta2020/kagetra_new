---
name: impl-event-list-month-grouping
description: 大会申込一覧 月区切り 実装
type: project
---

/events 開催日順ビューの月区切り（design-spec locked T-4）を実装。worktree=C:/tmp/impl-event-list-month-grouping・ブランチ feature/event-list-month-grouping。GitHub Issue は無し（純UI＝design-spec が要件成果物のため /define-feature を通していない）。

**スコープ解釈（実装上の最重要判断）**: design-spec §2 の見出しが「確定した delta（**開催日順のみ**）」で、§2-7 がソート非依存と名指ししたのは**フッター行（項目5）だけ**。よって日付ブロック・タイトル行からの日付除去・大会名の太さによる二重符号も**開催日順のときだけ**適用し、締切日順は出荷済み（event-list-redesign）の行のまま残した。締切日順で月見出しが無いまま日付ブロックだけ出すと「何月の大会か」が消えるため、この読みが実用上も正しい。判別材料＝既存の AC-10 テスト（既定=締切日順で 9/6(日) を assert）が**無改変で通る**こと。忠実度チェックリストの日付ブロック/二重符号/西暦の各項はソート指定なしで書かれているので、ユーザーがレビューで覆す余地は残る。

**コミット**: 77007e4(docs) / 9e5aa3a(タスク1 純関数) / 55cb7cd(タスク2 画面+docs/spec)

**変更ファイル**: event-list-utils.ts(+formatEventDay/groupEventsByMonth/WeekdayTone/MonthGroup)・EventListClient.tsx(MonthHeading 追加・EventRow に dateView prop)・page.tsx(見出し行削除→フッター行)・各 .test・docs/spec/events-attendance.md

**フッター行を page.tsx に置いた理由**: ソートにも 0 件表示にも左右されず必ず出す必要がある（見出し行を消した以上ここが唯一のアーカイブ導線）。加えて EventListClient 内に <a> を増やすと同ファイルのテストヘルパ renderedOrder（querySelectorAll('a')）が全滅する。

**忠実度ゲートの検証方法（ローカル DB が使えない場合の型）**: dev DB(5433) が旧スキーマ（entry_group_id 無し）で /events が 500、かつ future events 0 件のため実画面が使えなかった。代わりに ①dev server の /_next/static/css/app/layout.css を curl して arbitrary value ユーティリティの**生成CSS実在**を grep 確認（Tailwind はクラス名の [ ] と . をエスケープするので grep -F 必須。素の正規表現だと全部 0 件に見えて誤診する）②vitest から container.innerHTML を dump → その CSS と合わせた静的 HTML を public/ 経由で 375px 表示 → getComputedStyle で色・サイズ・overflow を実測。実 DB 無しで忠実度を測れる。
- 実測: docScrollW=innerW=375（横スクロール無し）／長い大会名 clipped=true／SUN=rgb(179,60,45)=accent・SAT=rgb(43,78,140)=brand・平日=rgb(122,110,90)=ink-meta／月数字 31px/600/brand/-0.93em相当／title weight 700↔400 が色帯と完全連動
- **Chrome の getComputedStyle は border-width を整数 CSS px に丸める** — 宣言 2.5px が computed 2px に見える（mock も同じ宣言なので劣化ではない）。生成CSS側で border-bottom-width:2.5px を確認するのが正しい検証
- .design-live ジャンクションを一時的に impl worktree へ向け直して design-live(3100) を起動→検証後に C:/tmp/design-live-kagetra へ復元した

**テスト**: events 配下 179 passed（新規 event-list-utils 8+2 describe / EventListClient 月区切り 10 件 / page.tsx フッター 3 件）。lint・typecheck green。ダークモードはこのアプリに存在しない（globals.css に prefers-color-scheme 無し）ので明暗確認は light のみ。
