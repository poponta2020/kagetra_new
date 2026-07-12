---
name: auto-review-pr276
description: PR#276(mail-worker clock drift修正) auto-review-loop ラウンド記録。カテゴリ auto-review-round
metadata:
  type: project
  category: auto-review-round
---

# auto-review-loop PR #276（fix/mail-worker-clock-drift-draft-subjects）

- R1: verdict=pass, blockers=0 / should_fix=0 / nits=0, effort=high(auto: review-extra高リスクパス apps/mail-worker/** 該当), 差分220行3ファイル
- AC適合チェック(acceptance-reviewer): pass。AC-1/2/3全て実機確認込みでsatisfied、Non-goal逸脱0
- 追加/code-review high: 8ファインダー→5候補→検証。**CONFIRMED2件はいずれも非ブロッカー**: ①persistOutcomeの非トランザクション部分失敗でnew_draft_subjectsが永久欠落しうる構造的regression（ただし追加検証でrunOnce→runAiPhase経路自体が本番では現在デッドコード=cronはmode=fetch-onlyでllmExtractor未指定、実運用AI抽出はrunManualExtractという別経路でnew_draft_subjects自体を使わないため実害なし。テスト経由でのみ到達可能）②jobs.tsのrecoverStaleClaimedJobsに同型のNode/DB時計比較(lt)が残存、requirements.mdのNon-goals「本件1箇所のみ」記述が実質オーバークレーム（ただし分〜時間オーダーの閾値でWSL2秒未満ドリフトには非該当）。PLAUSIBLE1件（subject取得のフォールバック文言が3箇所で不統一、全て本PR以前からの既存コード）。REFUTED2件（読み取り時ステータス再検証欠如=同じくデッドコード経由で実害なし／回帰テスト重複=誇張、実際は検証内容が異なり既存コード規約に整合）。いずれも本PRのdiff外・Non-goals範囲内のためこのPRでは未対応、フォローアップIssue化をユーザーに提案予定
- CI: 確認中 → auto-ship へ
