---
name: ローカル動作確認セットアップ
description: 家・会社両環境でアプリ動作確認を再現するためのエントリーポイント。env 配置・Cookie 注入 vs 実 LINE Login・mail-worker 実 API テスト手順・コスト目安・トラブルシュートまで網羅
type: reference
originSessionId: dbe29398-21c8-46b4-80be-ea12821b1f69
---
ローカル動作確認の手順は [docs/dev/local-dev-setup.md](../../../docs/dev/local-dev-setup.md) が one-stop reference。

## 中身の要点

- **env ファイルは 3 種類**: `apps/web/.env.local` (Next.js) / `packages/shared/.env` (drizzle-kit) / `<repo root>/.env` (mail-worker、未作成、実 API テスト時に追加)
- **2 種類のログイン**: `pnpm --filter @kagetra/web dev:cookie` で発行した JWT を Cookie 注入する最速ルート、または本物の LINE Login channel を `.env.local` に書いて `/self-identify` 経由で claim
- **mail-worker 実 API テスト**: Anthropic API キー + Yahoo!Mail メイン PW (App Password は 2025 後半から廃止)。Sonnet 4.6 単価で 1000 円 ≒ 360 通（標準ケース）。実測コストは 5/8 セッションで 1 通 $0.024 (標準ケース $0.018 より 33% 高め)
- **dev only ツールは `apps/web/scripts/dev-issue-cookie.ts`**: admin/member/vice_admin の seed + JWT 発行を idempotent に行う

## 何かを変えた時に追従すべき場所

- env 変数を増やした → 引き継ぎ書 1-2 節の env テンプレートを更新
- Drizzle migration を追加した → **`db:push --force` も `db:migrate` も非対話シェルでは TTY エラーで失敗する** (5/8 発覚)。確実な手段は `docker exec -i kagetra-db psql -U kagetra -d kagetra -v ON_ERROR_STOP=1 < migrations/000X.sql` で順次適用。引き継ぎ書 1-3 節の `db:push --force` 記述は信頼できないので doc 修正が carryover
- mail-worker の CLI フラグを増やした → 引き継ぎ書 3-3 節の表を更新
- Sonnet モデル / 単価が変わった → `apps/mail-worker/src/classify/cost.ts` と引き継ぎ書 3-5 節

## 2026-05-08 セッションで判明した重要トピック

- **Yahoo!JAPAN App Password は実質廃止** (note.com/440found 2026-04-04, whatsnewmail.yahoo.co.jp 20251008a)。引き継ぎ書 3-2 節は古い。代替は「メイン PW + IMAP 許可設定」(一時的措置、Yahoo 公式は推奨しないが imapflow LOGIN ベースから使える唯一の経路)。設定手順: `https://mail.yahoo.co.jp` → 歯車 → メールの設定 → IMAP/POP/SMTPアクセス → 「Yahoo!JAPAN公式サービス以外からのアクセスも有効にする」+ IMAP「有効にする」+ 保存。設定はユーザーアカウントに紐づくので 1 度きりで両環境共有
- **dev DB の migration 状態は worklog の記述だけ信じない** — 5/2 で「適用済み」と書いた 0005-0010 が 5/8 時点で欠落していた (テーブル数が 8 → 14 でないことで発覚)。新環境セッション開始時は必ず `\dt` で 14 テーブル確認
- **PDF base64 invalid bug 候補** — Anthropic に投げた PDF の 21% (4/19) が `The PDF specified was not valid` で失敗。優先度高めで切り分け要 (carryover)
