---
name: impl-mail-ai-extract-refinements-t1-t6
description: mail-ai-extract-refinements タスク1〜6
type: project
---

mail-ai-extract-refinements（親Issue #410）タスク1〜6を実装。worktree=C:/tmp/impl-mail-ai-extract-refinements（ブランチ feature/mail-ai-extract-refinements）。

## 完了タスクとコミット
- T1 #411 スキーマ3.0.0＋fixture移行（59b1ac3）— main直
- T2 #412 PDF上限 800→8000KB（d455331）— main直
- T3 #413 トークン実測（4dd21fe）— main直
- T4 #414 プロンプト改訂（6c5f30c）— task-implementer(sonnet)委譲・受け入れOK
- T5 #415 Sonnet 5移行（8c6dd2c）— task-implementer委譲・受け入れOK
- T7前半 #417 payment_deadline_kind + migration 0052（b44bc8a）— main直
- T6 #416 添付選択をclassifierへ（978ac4f）— task-implementer委譲・受け入れOK

## Wave構成
Wave1は計画では T1+T2+T3 の3並行だったが、**T1がスキーマ・classifier波及・fixtureのバイト精度移行・意味論判断を含むため main 直に変更**し、T2/T3も小径/調査のため main 直で直列実行した。Wave2=T4+T5 の2並行（prompt.ts と anthropic.ts で領域分離・衝突なし）。Wave3=T6単独。

## 計画になかった必須波及（重要）
1. **T1のスキーマ変更が web を型破壊する**。計画のT1変更領域は mail-worker だけだったが、ApprovalForm/ExtractedPayloadView/[id]/page.tsx が削除フィールドを読んでいた。機械的な型修復をT1に畳み込んだ（訂正版ヒント撤去=AC-19 はこの時点で完了済み、shortNameStem は null 固定）。
2. **CHECK制約の影響範囲が計画より広い**。events.payment_deadline を書く経路は /events/new・/events/[id]/edit・approveDraft・approveDraftUnits・propagateFieldsToGroup・test-utils/seed の6つ。前4つは eventFormSchema を通るので transform に正規化を1箇所置いて解決。伝播は schema を通らないため diffPropagatableFields で日付と状態を束ねた。
3. **drizzle-kit generate は backfill を出さない**。0052 は手で UPDATE を ADD CONSTRAINT の前に挿入。順序を sql テストでファイル内容として固定した（vitest は db:push なので migration 自体は走らない）。

## 設計判断
- ClassifyOutcome の noise variant は **削除せず残す**。classifyMail は producer でなくなったが persistOutcome は共有write path で pipeline が oversize_skipped/skipped_noise と同じ防御分岐に束ねている。要件§6が oversize ガードに同じ姿勢を明示しているのを根拠にした
- AC-9/12/13/14 はライブLLMでしか完全検証できないため、prompt.test.ts で「その挙動を生むガイダンスがプロンプトに載っていること」を検証する形にした
- Sonnet 5 移行ゲート: 実測比率1.04前後（3件・PDF 0.5〜3MB）。docs/features/mail-ai-extract-refinements/token-baseline.md

## 未了・注意
- reextractDraft（actions.ts:997）は classifyMail を**直接**呼ぶ。runManualExtract 経由ではないので selectedAttachmentIds を明示的に渡す必要がある（T7後半）
- triggerExtractDraft は選択の書き込みを **manual_extract ジョブ enqueue より前**に同一txで行うこと（後だとワーカーが NULL を読んで全添付送信になり、無言で機能が死ぬ）
- CorrectionHint.tsx は参照ゼロになった。T11 は ConfidenceBadge のみのスコープなので扱いを決める必要あり
- AC-25（実抽出が max_tokens で切れない）はライブAPI検証。出荷後に本番で確認
- web テスト残3件失敗（ApprovalForm.test.tsx 1件・[id]/page.test.tsx 2件）。いずれも T9 の担当領域
