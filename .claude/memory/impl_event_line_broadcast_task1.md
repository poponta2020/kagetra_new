---
name: impl-event-line-broadcast-deploy
description: event-line-broadcast 本番デプロイ完了 (2026-05-31)。Oracle Cloud Always Free 東京、2 Bot で運用開始→2026-06-01 に Bot プール 30 個 全 seed 完了、1 大会通しテスト成功
metadata: 
  node_type: memory
  type: project
  originSessionId: bdf544e9-cf0c-4681-90d4-e0b0d2b2c4aa
---

# event-line-broadcast 本番運用開始

## 状態更新 (2026-06-01) — Bot プール 30 個 全 seed 完了
- 本番 `line_channels`: event_broadcast **30 行** (29 available + 1 active)。当初 2 → 21 → 30 と増設し、これで設計通りの満タン。
- 増設フロー (実行済み): ローカル `C:/tmp/broadcast-channels-template.json` に bot 22-30 の 4 項目 (channelId/Secret/AccessToken/botId) を手入力 → `C:/tmp/fetch-bot-user-ids.ts <file>` で webhookDestinationId 取得 → scp で `/etc/kagetra/broadcast-channels.json` に配置 → `seed-broadcast-channels.ts --file=...`。結果 21 skipped / 9 inserted (row id 23-31)。
- **教訓: 手入力 botId は LINE API の basicId と必ず照合する**。bot-28 で `@952ijomk8` と末尾に余計な `8` を打鍵 → fetch スクリプトのログ `[ok] @952ijomk8: ... basicId=@952ijomk` で発覚 → 修正後に投入。LINE basic ID は `@` + 英数 8 文字固定。seed スクリプトは basicId 不一致は検出できない (botId はそのまま INSERT する) ので、fetch ログ照合が唯一の検出点。
- 本番ホストは seed 後 `/etc/kagetra/broadcast-channels.json` を**残さない運用** (今回 deploy 時に存在せず = 前回 operator が削除済み)。再 seed 時は再 scp が必要。secret-at-rest を最小化する意図。

## 状態 (2026-05-31)
- **本番稼働中** (new.hokudaicarta.com)
- **PR #65** (機能本体) + **PR #70** (XSS+MIME 修正) merge 済み (`d94199f`)
- LINE Bot 2 個運用中 (id=2 `@656jpsvg` / id=3 `@375dnfvx`)
- 親 Issue #54 + 子 #55-#63 全クローズ
- 1 大会通しテスト成功 (invite code → group → 紐付け → 1 メール配信)

## 本番環境構成
- ホスト: Oracle Cloud Always Free 東京 (`140.238.51.41`、Ubuntu 22.04, kagetra-vnc)
- timezone: **Asia/Tokyo** (broadcast cleanup timer の JST 04:00 発火のため)
- OS パッケージ: `poppler-utils 22.02.0` + `LibreOffice 7.3.7.2` + `fonts-noto-cjk` + `fonts-ipafont`
- DB: PostgreSQL 16 (`127.0.0.1:5432/kagetra`)
- 環境変数: `.env.production` に `PUBLIC_BASE_URL=https://new.hokudaicarta.com`
- systemd: `kagetra-web.service` + `kagetra-broadcast-cleanup.timer` (OnCalendar=*-*-* 04:00:00 JST)
- Nginx: `/api/webhook/line` + `/api/line-broadcast/*` 透過確認済み

## LINE Bot 運用
- Bot プール 30 個設計だが現状 2 個で運用開始
- 追加手順: LINE Console で channel 作成 → 4 項目 (channelId/Secret/AccessToken/botId) を JSON 追記 → `C:/tmp/fetch-bot-user-ids.ts` で webhookDestinationId 一括取得 → scp + `seed-broadcast-channels.ts` で本番投入 (backfill 対応済み)
- 年 10 大会・30 日縛りなら 2-5 個で十分の見込み

## 教訓 (新規 feedback memory)
- [[feedback-nextjs-standalone-static-cp]]: リビルド時 static cp 忘れない (画面真っ白)
- [[feedback-libreoffice-ja-fonts]]: Noto CJK 必須 (□化け対策)
- [[feedback-drizzle-kit-push-prompt]]: 本番は `db:migrate`、`db:push` は dev only
- [[feedback-attachment-mime-blocklist]]: 公開添付 route は blocklist + attachment 固定

## How to apply (今後の追加 Bot)
1. LINE Console で Bot 作成 (channelId/Secret/AccessToken/botId の 4 項目控える)
2. `C:/tmp/broadcast-channels-template.json` に追記
3. `pnpm exec tsx C:/tmp/fetch-bot-user-ids.ts <path>` で webhookDestinationId 自動取得
4. `scp` で本番 `/etc/kagetra/broadcast-channels.json` に上書き
5. ssh から `seed-broadcast-channels.ts --file=...` を実行 (既存は backfill or skipped)

## 関連
- PR #65: https://github.com/poponta2020/kagetra_new/pull/65
- PR #70: https://github.com/poponta2020/kagetra_new/pull/70
- デプロイ手順書: docs/deploy/event-line-broadcast.md
