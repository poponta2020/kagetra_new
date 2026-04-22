---
name: kagetra_new 設計判断まとめ
description: コードからは読み取れない設計判断・却下理由・運用ルール。技術スタック選定からPhase別の判断まで。
type: project
originSessionId: d060af2a-38b3-425f-943b-6ac1a42f0988
---
## kagetra_new 設計判断

poponta2020/kagetra（Ruby/Sinatra/Backbone.js）の完全リプレイス。競技かるた会向け。

**Why:** 元アプリの技術スタックが古く保守不能。モダン技術で再構築。
**How to apply:** 実装判断はこの設計書に基づく。変更はユーザーと合意の上。

### 技術選定（2026-04-15確定）

1. **Next.js 15 + Hono + PostgreSQL 16 + Drizzle ORM + TS strict** — 却下: Java/Spring Boot, Vue/Nuxt
2. **Next.js(BFF) + Hono(API) 分離構成** — 却下: Next.jsフルスタック一本（LINE Webhook・AI処理が制約される）
3. **LINE Login 認証 (Auth.js built-in LINE provider、JWT session)** — 変遷: Apr 15-16 に LINE Login で設計 → Apr 18 に旧会員66名の identity 紐付け困難を理由に Credentials (username+password+bcrypt) へ切替 (PR #3) → Apr 21 に再度 LINE Login へ戻す決定 (PR #5 で実装)。66名問題は「LINE login → 未リンクなら /self-identify で本人選択 → 即時紐付け」の自己申告フロー (option C 事後 admin モニター) で解決。
4. **LINE通知: 1チャネル1人方式（80チャネル）** — 月200通無料枠活用。認証とは別機能。Phase 2 で実装。LINE Login OAuth で `lineUserId` を必須取得（全員連携）
5. **AI: Yahoo!JAPAN Mail IMAP → Claude API振り分け → 管理者承認**
6. **AWS Lightsail $5/月〜** — Lightsail+AI API以外は無料
7. **Codexレビュー** — PR作成後にClaudeがプロンプト生成→ユーザーがVS Code上のCodexに依頼
8. **4フェーズ**: P1基盤 → P2大会運営 → P3 AI+メール → P4コミュニティ
9. **データ移行**: 一括スクリプト、全データ引き継ぎ、旧システムP4完了まで並行稼働
10. **UI**: モバイルファースト、日本語のみ。デザイン詳細は参考デザインを探してから

### ドメインルール（2026-04-16 grill-meで確認済み）

11. **アプリの前提**: 大会の参加・申込管理がメイン。大会以外のイベント管理は想定していない
12. **旧kagetraのEAVパターン（event_choices/event_user_choices/user_attributes）は不採用** — 複雑すぎる。参加/不参加のbooleanで十分
13. **未回答 = 不参加扱い** — 基本参加しない人は回答しない運用
14. **締切の使い分け**: 会内締切=出欠ロック用（締切後は一般会員変更不可）、大会申込締切=管理者リマインド用（P2 LINE通知で活用予定）
15. **団体戦(team_size)は後日追加** — Phase 1では個人戦のみ。ユーザーから「欲しくなったら追加する」
16. **大会グループの運用例**: さがみ野大会 → 春B級, 秋A級 を1グループに

### 監査設計 (2026-04-21 確定)

18. **LINE 紐付け監査**: `users.line_linked_at` (timestamptz) + `users.line_linked_method` (enum: `self_identify` / `admin_link` / `account_switch`) で記録。admin 画面で最近順ソート + ワンクリック解除 (lineUserId/lineLinkedAt/lineLinkedMethod を NULL に戻す)。解除された会員は次回 LINE login で /self-identify から再選択可能。`admin_link` 値は将来の admin 手動紐付け機能用に予約 (PR #5 では未使用)。
