---
name: feature-def-openchat-broadcast
description: openchat-broadcast 要件定義
type: project
---

# openchat-broadcast 要件定義（大会オープンチャットの抽出・LINE配信）

親Issue **#457** / 子 #458-#468（11タスク・7 Wave）。正典 = `docs/features/openchat-broadcast/`（requirements.md / design-spec.md / implementation-plan.md / **feasibility.md**）。

## ★最大の成果: 「AIなしで99%自動配信できるか」に本番データで答えた

正典 = feasibility.md。本番 mail_messages 286件（2026-05-16〜08-06）を SSH トンネル経由で実測。診断script = scripts/diagnostics/openchat-coverage*.mjs（gitignore）。

- 分母の取り方が肝: 「拾えたURL/拾えたURL」だと100%になる。正しい分母は**招待が届いたメール20件**
- テキスト抽出の上限 = **14/20 = 70%**（直リンク11・短縮URL3）。**QRのみ6件（30%）**
- **メールにURLが存在しないケースがある** — 協会30周年記念大会(当会出場)は「URLは大会用LINEアカウント内でご案内」。AIでも不可能
- ★決定打: 全286件のうち**当会イベント紐付けは21件(7%)のみ**。オープンチャット言及27件中の紐付けは5件。自動配信＝出場しない大会のオプチャを22件スパム配信する
- 当会が実際に関係する5件だけで測ると **3/5 = 60%**
- 1メールに複数URLが普通（級別3本/開催日別2本/部門別5本）。どれを誰に配るかは機械的に決まらない
- 本文中のURLは**改行で割れる**（さがみ野で実発生）。壊れたURL配信＝50名に無効リンク
- パスワード（参加コード）の実例は**286件中0件**

→ **AIを入れる価値も薄い**（URL非存在・出場可否はAIでも解けない）。トリガーは人間・抽出は決定的・確認画面で人が確定。

## 設計判断

- 保存単位 = **entry_groups**（LINE紐付けが entry_group_id UNIQUE。どの日の詳細から操作しても同じ）
- 属性 = 級（複数可・null=全級）＋開催日（null=全日）＋**自由ラベル**。部門別（団体戦/1年/選抜）はラベルで吸収
- 級別にLINEグループは分けない（line_grade_group_bindings は0件で未運用）
- Flex 1バブル・ボタン縦並び（carousel不採用=スワイプしないと他級に気づかない）
- **バブル内テキストは「大会オープンチャット」＋大会名の2つだけ**（ユーザー判断で説明文・注意書きを全削除）
- LINE Flex に**クリップボードアクションは無い** → パスワードは長押しコピーのテキストが上限
- QR = sharp(既存依存)→jsQR。zxing-wasm不採用。**renderPdfToJpegs の DPI は触らない**（出荷済み経路）

## ★実装前に潰した2つの地雷

1. **event_broadcast_messages の UNIQUE(broadcastId, mailMessageId) と「毎回全件再配信」が原理的に衝突**。同じメールからの2回目が DB 制約違反で落ちる。→ requirements §6 に「オープンチャット配信は同テーブルに記録しない・UNIQUE を緩める解決は禁止」を契約として明記し、専用の履歴テーブルを持つ（AC-40/41）
2. **ラベル重複**（デザイン中に発見）。級でも日付でもない分かれ方だと自動ラベルが全行「オープンチャットに参加」→ **同名ボタンが5個並ぶFlexが50名に届く**。保存をブロックするルールを要件へ追加（AC-47〜49）

## その他

- AC 54件（auto-test 52 / manual 2）。manual 2件は「実pdftoppm出力のQR」（既存テストは renderPdfToJpegs を mock しており単体では自作mockの検証にしかならない）と「LINE実機のFlex表示」
- タスク6は既存 line-broadcast.ts から binding再検証・401/4xx復旧を**移動のみ**で export 化。書き直すと必ず乖離するため
- Wave 1 は packages/shared 単独（全パッケージのテストへ波及するため他と混ぜない）
- デザイン = Path D（Flexは実コードでプレビュー不能なため Path L の利点が効かない）。design-spec は locked・忠実度チェックリスト14項目
