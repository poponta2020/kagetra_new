---
name: ship-line-attachment-flex-card
description: LINE添付リンクをFlexファイルカード化
type: project
---

LINE 配信の添付リンクを、生 URL のテキスト 1 通から **Flex Message のファイルカード**へ置き換えた出荷記録。

- PR #449 https://github.com/poponta2020/kagetra_new/pull/449
- マージ: 成功（merge commit c8657cf・2026-08-04）。CI は pending のままマージ（方針 v0.9.0。赤なら追修正）
- 親 Issue: なし（quickfix 起点）

## 何を変えたか

LINE のテキストメッセージは表示文字列と URL を分離できず（ハイパーリンク非対応）、Bot はネイティブのファイルメッセージを送信できない（受信専用）。そのため署名 URL がそのままトークに露出していた。Flex Message のファイルカードで模倣するのが唯一の手段。

- 新設 apps/web/src/lib/line-flex-attachment.ts — pure な共通ヘルパー（webhook 経路から import されるため重依存を持たない）。種別バッジ（Excel 緑 #217346 / PDF 赤 #D93025 / Word 青 #2B579A / その他グレー #64707D）＋ファイル名＋サイズ、カード全体の uri アクションで署名 URL を開く
- line-broadcast.ts renderAttachment — 旧 buildFallbackTextMessage を削除して Flex 化。監査 role は attachment_link のまま、5 通/バッチ・partial resume・再送ロジックは不変
- line-broadcast-guidelines.ts — 要綱 push も「大会要綱」タグ付きカード化。サイズは octet_length で取得（bytea 本体を引かない）
- altText は 📎 ファイル名（タグ付きは 📎【大会要綱】ファイル名）。400 UTF-16 単位で切り詰め、**コードポイント境界で止める**（𠮟・𩸽 等のサロゲートペアを分断すると通知に不正文字が出る）

## 設計判断

**altText 上限は 400 のまま据え置き（Codex の 1500 引き上げ提案は WONTFIX）**。1500 という値を LINE 公式ドキュメントで確認できず、リスクが非対称だったため。1500 が正なら 400 字超ファイル名の不要な切り詰めが起きるだけだが、400 が正で 1500 に上げると LINE API 400 で**配信失敗**になる。メール添付のファイル名が 400 字を超えることは実運用で発生しない。

## レビュー

auto-review-loop 1 ラウンド（initial / gpt-5.6-sol / effort high・215,209 トークン）。blockers 0・should_fix 1（局所）で 3-d 条件2 の打ち切り。**修正後の再レビューは未実施**（サロゲートペア境界の 3 行修正のみ・CI に委譲）。詳細は [[auto-review-round-pr449]]。

## 残 DoD

- 本番実機確認: LINE グループでカードが表示され、タップでダウンロードできること。**Flex の実機レンダリングはテスト不能**なので出荷後に本番で確認する。崩れていたら bubble の size/レイアウトを調整する
