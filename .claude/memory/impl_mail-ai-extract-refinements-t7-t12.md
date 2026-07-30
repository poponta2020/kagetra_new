---
name: impl-mail-ai-extract-refinements-t7-t12
description: mail-ai-extract-refinements タスク7〜12
type: project
---

mail-ai-extract-refinements（親Issue #410）タスク7〜12を実装し全12タスク完了。worktree=C:/tmp/impl-mail-ai-extract-refinements（ブランチ feature/mail-ai-extract-refinements）。タスク1〜6は [[impl-mail-ai-extract-refinements-t1-t6]]。

## 完了タスクとコミット
- T7 #417 payment_deadline_kind + migration 0052（b44bc8a）/ Server Action 検証（c88b997）— main直
- T8 #418 添付選択ダイアログ（a6630ec + 修正 72f967d）— task-implementer委譲
- T10 #420 受信箱一覧の tier 廃止（08c4134）— task-implementer委譲
- T12 #422 振込締切状態の3面反映（2aea0e7）— task-implementer委譲
- T9 #419 承認フォームの通称欄・ドラフト詳細（d89d224）— main直
- T11 #421 ConfidenceBadge + CorrectionHint 削除（43a976e）— main直
- docs 反映（23bbca6）

## Wave構成
Wave={T8, T10, T12} の3並行。T9 は [id]/page.tsx で T8 と、event-form.tsx で T12 と重なるため**同じ Wave に入れず後続**にした（計画の Wave6 は T9+T10+T12 だったが、T9 が EventForm にタイトル制御入力を足す必要があり T12 と衝突するため分離）。T9 は判断が重く main 直で実施。

## 実装上の要点（後から効く）
1. **EventForm のタイトルを制御入力にできる口を足した**（titleValue / onTitleChange）。非制御 input は defaultValue の変化を無視するので、通称欄の入力に追随できない。onTitleChange を渡さない既存呼び出しは非制御のまま。
2. **承認フォーム（embedded）には振込締切状態の select を出さない**。AI ペイロードの日本語3値を hidden input で英語 enum に写す（AC-39）。日付は EventForm で編集でき、サーバー側 normalizePaymentDeadline が日付を正として整合させる。
3. **選択の書き込みはジョブ enqueue より前**（同一tx）。逆だとワーカーが NULL を読んで全添付送信になり、エラーも出ずに機能が死ぬ。テストで固定した。
4. **reextractDraft は runManualExtract を通らず classifyMail を直接呼ぶ**ので、選択を明示的に渡す必要があった（pipeline 側の読み出しには乗らない）。advisor の指摘で発見。

## ワーカー成果物の受け入れで直したもの
- T8 のテスト2件が落ちた（ワーカーはテスト実行禁止のため）。(a) disabled checkbox への fireEvent.click は jsdom では toggle されてしまう → toggleAttachment 側でも上限超過を弾く実装に変更（防御としても正しい）。(b) JSX の改行がテキストノード内で空白に潰れる → 部分一致に変更。
- T12 の EntryBoardItem 追加で EntryBoardClient.test.tsx のフィクスチャが型エラー。

## 未確認・残作業
- **AC-25**（実抽出が stop_reason: max_tokens で切れない）はライブ API 検証。ローカルでは閉じられない。出荷後に本番で確認
- 本番 .env の MAIL_WORKER_PDF_SIZE_LIMIT_KB 確認（未設定なら既定 8000 が効く）
- 本番 migration は db:migrate（db:push は対話プロンプトで詰む）
- 計画の残作業にある「hub_mail_attachments.md の mail-inbox-mailer は実装未着手」は**既に修正済み**だった（確認して対応不要と判断）
