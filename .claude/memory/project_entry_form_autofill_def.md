---
name: feature-def-entry-form-autofill
description: entry-form-autofill 要件定義
type: project
---

大会申込書xlsx自動記入＋Yahooメール下書き作成（entry-form-autofill）の要件定義・設計・技術計画が完了。正典= docs/features/entry-form-autofill/（requirements.md / design-spec.md locked / implementation-plan.md / design-mock 11枚）。

主要な設計判断:
- 下書きは IMAP APPEND で Draft フォルダへ直接作成（SMTP依存の追加を契約で禁止＝送信は構造的に不可能）。Draft フォルダ・送信済み定型文は実機IMAPで確認済み
- xlsx 記入は exceljs 純コード（実テンプレ10件でラウンドトリップ無傷を実証、openpyxl は part 欠落で不採用）。数式セルには書かない
- AI は Haiku 4.5 の2用途のみ（セルマップ推定fallback／主催者指定の件名・ファイル名・申込先の抽出）。常にプレビュー目視
- S2 は B案=3ステップウィザード採用（A案縦スクロールはモック比較で不採用）。EntryFlow 意匠をステップ表示に転用・脱カード
- 姓名かな欠損はプレビュー補完→users へ書き戻し（4フィールドのみ）。履歴（生成xlsx bytea 含む）は IMAP 実行前に保存＝失敗でも編集値が残る
- 新テーブル: app_settings（会定数6項目 key-value）+ entry_form_drafts（migration 0050）。会定数は設定ハブ配下 /settings/entry-form で編集
- 出場回数は appearance-counts（基準日=作成日）自動計算＋編集可

AC: 21件（auto-test 19 / manual 2 = SMTP不在レビュー・本番実機）。Non-goals: 自動送信（永久）・他会代理・Googleフォーム・団体戦・Word/PDF。

Issues: 親 #381 / 子 #382-#389（8タスク・Wave1=T1/T2/T3, Wave2=T4/T5/T6, Wave3=T7, Wave4=T8）。
残DoD候補: 本番 web コンテナへ YAHOO_IMAP_* env 追加（実値は手作業）+ AC-21 実機確認。
実装は /implement entry-form-autofill で開始。関連: [[project-entry-form-autofill-direction]]（grill-me合意）
