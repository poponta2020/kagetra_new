---
name: feature-def-mail-ai-extract-refinements
description: mail-ai-extract-refinements 要件定義（改修）
type: project
---

# mail-ai-extract-refinements 要件定義（改修・2026-07-29）

正典 = docs/features/mail-ai-extract-refinements/{requirements.md, implementation-plan.md}。親Issue #410 / 子 #411-#421。AC 38件（auto-test 36 / verify 1 / manual 1）。実装未着手。

## 起点になった発見

**cron の自動 AI 抽出は既に廃止済みだった**（index.ts:122-131。`--mode=fetch` は llmExtractor:undefined）。AI が走るのは管理者が「会で流す（AI 抽出）」を押した `--mode=extract` だけ。つまり「人間が事前に大会案内だと判断する」運用はコード上すでに成立しており、**プロンプトとスキーマだけが旧運用のまま取り残されていた**。この事実がプロンプト3割削減の根拠。

## 主要な設計判断

- **分類フィールドは残さず消す** — 残すと AI は必ず埋めようとし、その判断のために資料を読む。人間が下した判断を再実行させるのはトークン代を払って矛盾リスクを買う行為
- **confidence は再定義せず削除** — 現行定義は「分類が正しい確率」。抽出精度に読み替えても自己申告値は校正できず、全件レビュー運用では意思決定に使えない。reason を人間向け抽出メモに作り替える方が実用的
- **short_name_stem は人力入力に戻す** — 通称は「大阪」程度で人間の入力コストはほぼゼロ。一方 AI には「第N回」「競技かるた」等をそぎ落とす曖昧な判断でプロンプト1節を消費していた。composeTitle() は残し供給元だけ差し替える
- **fee_jpy 削除** — 級から決定的に導出可能（定数は packages/shared に実装済み）。決定的に求まる値を AI に読ませるのは誤読リスクだけ増やす
- **payment_deadline_kind（日付あり/後日連絡/記載なし）を追加** — 現状 null が「案内に後日連絡と書いてある」と「AI が読めなかった」の両方を意味し、対応がまったく違うのに区別できなかった
- **payment_method / entry_method を日本語 closed enum に** — 実値が2〜3種に集中。自由テキストは表記ゆれが溜まる
- **プロンプトキャッシュ撤去** — 手動起動＝都度1件ではどの TTL でもヒットせず書込プレミアム（1h=2.0×）だけ払う。なお prompt.ts の「2048トークン閾値」コメントは元から誤り（Sonnet 4.6/5 の最小キャッシュ長は 1024）
- **添付選択は既定「全て未チェック」** — 要綱以外が混ざるとトークン代と誤抽出が両方悪化。選択忘れは確認1段で防ぐ

## 調査で確定した技術事実

- **events.capacity 列が既存**（汎用イベント定員・イベント編集画面で読み書き）→ capacity_total の受け皿。マイグレーション不要
- **events.paymentType（advance/onsite）は申込管理ボード・支払い催促で現役** → payment_method（text）とは別物。AI は payment_method だけ埋め paymentType には触らない分離を維持
- **fixture はスキーマ形状のペイロード**（apps/mail-worker/test/fixtures/llm/*.expected.json）。削除フィールドを含むため移行必要だが、**再生成すると回帰ベースラインが消える**。削除対象2フィールドの除去だけに限定し events[] は1バイトも変えない
- **Web 層は保存済み payload に Zod を再実行しない**（[id]/page.tsx:103-122 の防御的ナローイング）→ 必須フィールドを消しても既存行は壊れない
- **Sonnet 5 の最大の罠**: 4.6 は thinking 省略＝思考なしだが 5 は省略＝adaptive ON。max_tokens が思考と出力を合算するため明示 disabled しないと record_extraction が切れる

## 意図的に残す（削除禁止）もの

- **oversize_skipped ガード** — 上限8000＋UIブロックで正常系では到達不能になるが、Server Action 直叩き・多重タブへの防御
- **pre-filter は手動経路の入口を塞ぎうる** — force:true が prefilter をバイパスするのは classifier 内部だけ。一覧に出ないメールは「会で流す」を押しようがない。救済経路は一覧の「ノイズ」フィルタのみ
- confidence 列 / superseded_by_draft_id 列 / events.fee_jpy 列は DROP しない（書き込みと表示を止めるだけ）

## Wave 構成

W1: #411(スキーマ+fixture) #412(サイズ上限) #413(トークン実測ゲート) / W2: #414(プロンプト) #415(Sonnet5移行) / W3: #416(classifier添付選択) / W4: #417(migration+ServerAction) / W5: #418(選択ダイアログ) / W6: #419(承認フォーム) #420(一覧) / W7: #421(ConfidenceBadge削除)

**#413 は移行ゲート**: 代表PDFで両モデルの count_tokens を実測し、1.5倍超なら移行可否をユーザーに再確認してから #415 へ進む。
