# Sonnet 4.6 / Sonnet 5 入力トークン実測（移行ゲート）

対応 AC: **AC-24**（実測でトークン数が 1.5 倍を超えた場合は移行の可否をユーザーに再確認する）

## 判定

**移行してよい。比率は 3 件とも 1.04 前後で、ゲート（1.5 倍）を大きく下回る。**

## 測定条件

- 実測日: 2026-07-30
- API: `POST /v1/messages/count_tokens`（課金なし）
- 入力の組み立ては実際の抽出リクエストと同一 — `system`（`buildSystemPrompt()`）＋ `tools`（`record_extraction` の `input_schema` = `ExtractionPayloadSchema` の JSON Schema）＋ user content（PDF を `document` ブロックとして先頭、`buildUserPrompt()` のテキストを末尾）
- システムプロンプトは**改訂前（PROMPT_VERSION 2.1.0）のスナップショット**を両モデル共通で使用。比較したいのはモデル間の差（トークナイザ・PDF のページ課金エンベロープ）であり、プロンプト改訂は両モデルに等しく効くため、この差し替えは比率に影響しない
- データ: ローカル dev DB の実際の受信メール（本文＋要綱 PDF 添付）
- スクリプト: `scripts/diagnostics/measure-extract-tokens.ts`（使い捨て・gitignore 対象）

## 結果

| # | メール | PDF | PDF サイズ | 本文 | Sonnet 4.6 | Sonnet 5 | 比率 |
|---|---|---|---|---|---|---|---|
| 1 | 第9回全国競技かるた大阪なにはえ大会(CD級)のご案内 | 大会案内 | 777,354 B | 713 文字 | 13,214 | 13,866 | **1.0493** |
| 2 | 第4回全国競技かるた千葉大会（A級）開催のご案内 | 大会案内 | 464,642 B | 612 文字 | 14,870 | 15,519 | **1.0436** |
| 3 | 第4回全道大会 個人戦＆団体戦 実施要項の送付について | 開催要項 | 3,003,791 B | 929 文字 | 16,984 | 17,643 | **1.0388** |

1 件だけで判断しないよう、サイズが 0.5MB〜3MB に散る 3 件で確認した。PDF が大きいほど比率はむしろ下がる（差分の絶対値が ~650 トークンでほぼ一定＝モデル固有のオーバーヘッド差であり、入力量に比例していない）。

## 読み取り

- 増分は入力全体の **+4〜5%**。Sonnet 5 は 2026-08-31 まで導入価格で 3 割安のため、実請求はむしろ下がる
- 定価に戻った後も +4〜5% で、上位互換を得る対価として妥当
- `thinking: disabled` を明示しない場合は adaptive thinking が出力側に乗る。本表は**入力**トークンのみの比較であり、出力側の暴発は別途 `thinking: { type: 'disabled' }` で塞ぐ（requirements §3.2.1）

## 再現手順

```sh
cd apps/mail-worker
DOTENV_CONFIG_PATH=<repo>/.env \
DATABASE_URL="postgresql://kagetra:kagetra_dev@127.0.0.1:5433/kagetra" \
  pnpm exec tsx -r dotenv/config ../../scripts/diagnostics/measure-extract-tokens.ts <mail_attachments.id>
```
