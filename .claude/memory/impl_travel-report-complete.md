---
name: impl-travel-report-complete
description: travel-report 実装完了（タスク1-8）
type: project
---

travel-report（遠征届）実装完了（branch feature/travel-report・worktree C:/tmp/impl-travel-report）。タスク1〜8 すべて完了・push 済み。

**Wave 構成と委譲**: W1=T1(main:スキーマ) / W2=T2・T3・T4(worker×3) / W3=T5 lib+T7 純関数(main) / W4=T5 UI(worker×2: S8 と S7+S9)・T6(main)・T7 UI(main) / W5=T8(main docs)。ワーカーは検証コマンドを eslint だけに限定（worker_verify: none）、テストはバリア後に main が直列実行。

**★実装中に見つけた重要な事実**
- **after() はリクエストスコープの外で throw する**。section-view.ts の開催地 AI 推定を after() でスケジュールしたら、ページを直接レンダーする既存 page.test.tsx が3件落ちた。推定は補助なので try/catch で握りつぶす形に修正。**RSC の単体テストがある画面で after() を使うときは必ず握りつぶす**
- **PII の scrub 対象を「文字列」で書くと、その文字列自体がリポジトリに残る**。build-template.mjs と PII 検査が原本の氏名・電話番号を持っていて、テンプレはクリーンなのに §7（原本の個人情報を git 履歴に残さない）を検査側が破っていた。→ 段落番号＋残す run 数の**位置指定**へ変更し、様式のラベル（個人情報でない）だけを検査に使う形にした。検査も「値の場所が空白だけ」になり強くなった
- **jest-dom は未導入**。ワーカーが toBeInTheDocument/toHaveAttribute/toHaveTextContent を使って落ちた。素の DOM（textContent・getAttribute・not.toBeNull）で書く
- **afterAll(closeTestDb) を describe の中に置くと後続 describe が全滅する**（Cannot use a pool after calling end on the pool）。トップレベルに1つだけ。ワーカー2人が同じ罠を踏んだ
- **<input list> の role は combobox**（textbox ではない）
- **next lint（リポジトリ全体）はファイルスコープ eslint が出さないエラーを出す**。no-html-link-for-pages が API route への <a> を誤検知 → download 属性を付けると解消する
- requirements AC-4 の「大学院21」は数え違いで R1 の列挙は22件

**意図的な仕様逸脱（ユーザー報告済み）**: S4 顧問教員の初期値を「原本の値」でなく**空**にした（原本の氏名をコードに埋め込むと §7 に反するため。未設定でも作成成功・空欄になる仕様 R13 があるので支障なし）

**残: 忠実度チェックリストのうち視覚項目（375px 横スクロール等）は静的照合では判定不能＝未確認**
