---
name: feature-def-member-mail-search
description: member-mail-search 要件定義・デザイン確定
type: project
---

会員向け受信メール検索・閲覧（読み取り専用）。親Issue #470 / 子 #471-478。要件=docs/features/member-mail-search/requirements.md、デザイン=design-spec.md(locked・案A)、手順=implementation-plan.md。

## 本番データ検証で判明した設計の要（ここが本機能の肝）
- **処理履歴は既存カラムからの導出**（履歴テーブル新設せず）。ユーザー選択。管理者フロー無改修＝会員側は完全読み取り専用を維持できる
- **triaged_at が NULL の processed が67通**。migration 0018 が `UPDATE mail_messages SET triage_status='processed'` で一括処理済み化した際に日時を入れなかったため。→ 日付を捏造せず省略する（ユーザー選択）
- **classification='noise' はスパム判定ではない**。classifier.ts:507-520 のとおり AI の「新規の大会案内ではない」判定で、実体は抽選結果・名簿共有・結果報告・ライブ配信案内など会員に有用な61通。**除外基準に使えない**（当初 noise 除外を検討したが実データ確認で覆した）
- **承認済みドラフト34件のうち10件は events.tournament_draft_id で大会名が引けない**。訂正版を既存大会に紐付ける linkDraftToEvent は tournament_drafts.event_id 側に書くため。**両者の和集合が必須**
- **triage_status='processed' の書き手は actions.ts に8箇所**。うち approveResultDraft(結果取込承認) は現状すでに「対応不要」と誤ラベルされる → H0「試合結果として取り込み」を追加（senseki-boundary 物理削除対象として1関数に隔離・AC-33 で可搬性担保）
- 公開範囲は**全件（未処理含む）**。他会名簿のPIIを含むが、招待制・LINE配信で既に会員が受領済み・大会関連だけに絞ると事務連絡が見えず機能不成立、の3点で受容

## AC
全37件（auto-test 35 / verify 1 / manual 1）。manual は実機375pxの動線のみ

## デザイン（Path D・Kagetra Design System）
案A タイムライン採用。**ユーザーがラウンド2で claude.ai/design 上で直接2点変更し確定**:
1. 詳細のセクション順を「ヘッダ→添付→本文→処理の記録」へ（会員の主目的は添付を開くこと）
2. 一覧カードから差出人を削除（代わりに履歴の最新1行を置く）
不採用=案B行リスト（処理ラベル4色でカード内色数が増え和紙×藍から浮く）

## Wave 構成
W1: #471履歴導出 / #472検索 / #473添付ルート（ディレクトリ直交）
W2: #474一覧 / #475詳細 / #476ビューア（同一dirだが触るファイルが重ならない）
W3: #477ナビ開放  W4: #478忠実度チェック＋回帰

## 実装上の非自明な判断
- 会員用添付ルートは管理者ルートの inline 許可リストを**コピーして独立実装**（共有抽出は管理者ルート変更＝Non-goal に抵触）。drift は両ルートへ同一入力を投げてヘッダ一致を assert するブラックボックステストで防ぐ
- マイグレーション不要・全て SELECT
