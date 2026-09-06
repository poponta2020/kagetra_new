---
name: impl-line-bot-message-revamp-mail-payment-notice
description: メール処理画面からの振込連絡 実装(2026-09-04)
type: project
---

PR #575 準備中 / ブランチ feature/line-bot-message-revamp（worktree: C:/tmp/impl-line-bot-message-revamp）。親 Issue #567・子 #568〜#574。

**やったこと**: メール処理画面（/admin/mail-inbox/mail/[id] の統合処理フォーム）から、確定名簿メールの処理と同時に会計へ振込連絡を送れるようにした。全7タスク（migration 0063 → 判定ロジック → 送信コア → ドラフト取得 Server Action → processMail 拡張 → UI → 失敗表示）。

**設計判断（レビューで問われそうな点）**
- `loadPaymentNoticeContext` の戻り値を `{ok:true, context} | {ok:false, reason, message}` へ変更したが、**`no_priced_grade` だけは ok:true のまま `context.availability` に載せる**。ここで弾くとグループページのセクションが消え、従来の露出条件（AC-48）が変わってしまうため。逆に `no_line_binding` はローダー側で弾くようにした（グループページの `&& hasLineBinding` 追加判定を消して判定を1箇所に寄せた）。
- `payment-notice-availability.ts` は client から import されるので `server-only`/schema/drizzle を型ごと入れない。理由の**日本語ラベルもここに置く**（UI と二重定義しない）。
- processMail の `after()` 登録条件を `input.broadcast` だけに縛るのをやめ、`linkedEventId != null && (broadcast || paymentNotice.send)` へ広げた。`isCurrentGeneration` は既存2系統とクロージャ共有。
- 共通項目の伝播先は `qualifying`（cutoff/cancelled/individual で絞った代表候補）ではなく **`groupEvents`（中止の日を含む全件）**。絞った方を渡すと中止の日へ保存されず AC-40 が静かに落ちる（advisor 指摘）。
- `send:false` では `entry_group_payment_notices` の行を作らない（`total_jpy` が NOT NULL なので 0 円の送信記録が生える）。

**踏んだ罠**
- 実装手順書・要件定義書がメイン側で untracked 更新（M）のまま、直近コミットは旧版（全タスク `- [x]`）だった。worktree 作成直後に**無条件で上書きコピー**＋frontmatter `status` を直して最初のコミットにしないと、着手可能タスク0件で止まる。
- `vi.mock('@/lib/event-grade-broadcast')` を丸ごと差し替えると `resolveTargetGrades`（参加費の級解決が使う純関数）が消えて `resolveEntryFee` が落ちる。`importActual` スプレッド必須。
- MailProcessForm が `../payment-notice-actions` を値 import するようになったので、既存の `OpenChatExtractSheet.test.tsx` にも同じ mock を足す必要がある。

**残**: 本番実機確認（AC-21 / AC-51 = 実際の確定名簿メールを処理して会計へ届くこと）。ローカルは対象テストのみ green（フルスイート未実行）。
