---
name: quickfix-rename-app-to-hokumei
description: quickfix: rename-app-to-hokumei
type: project
---

アプリ名を「かげとら」から「北溟」へ変更した（PR #639 https://github.com/poponta2020/kagetra_new/pull/639・コミット 8f957c4）。

**修正内容**: 表示名のハードコード（PWA manifest name/short_name・layout.tsx の title/appleWebApp.title・ログイン/招待登録/メール共有ページ）を「北溟」へ。LINE 配信文面の自己言及「景虎上の申込人数」「景虎上の想定金額」「景虎の進行管理から」（line-webhook-handler.ts / payment-report-message.ts / line-chat-command-reply.ts）も「北溟」へ。mail-worker の classify/prompt.ts の自己紹介も追随。docs/spec/ui-shell.md・notifications.md・docs/design/*.md・ui_kits のワードマークを更新。

**根本原因（構造）**: アプリ名は定数化されておらず 27 ファイルに文字列で散在。今回も定数化はせず文字列置換のみ（スコープ維持）。次に名前を変えるときは grep 'かげとら|北溟|景虎上' で全件拾える。

**変更しないもの**: 識別子（@kagetra/*・DB名・Bot ID @kagetra-event-bot-N・tmp接頭辞・MIME boundary・nginx conf 名）、コード内コメントの「Kagetra Design System」等、docs/features/ 配下（履歴）。

**残課題**: ①アプリアイコン apps/web/public/icons/*.png と apple-touch-icon.png は「か」の1文字入りのため別途「北」等へ差し替えが必要（本PR未対応）。②PWA をホーム画面に追加済みの端末は再追加まで旧名のまま。③docs/materials の会員向けガイド PDF は「かげとら（仮）」のまま（untracked）。④LINE Bot の表示名は LINE Developers コンソール側。

**テスト**: 変更ファイルをカバーする vitest 7 ファイル 125 テストを worktree（隔離DB kagetra_test_hokumei）で実行し pass。
