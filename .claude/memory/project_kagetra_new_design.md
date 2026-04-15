---
name: kagetra_new 設計判断まとめ
description: kagetra_new プロジェクトの全設計判断（技術スタック、アーキテクチャ、機能スコープ、開発ルール等）。2026-04-15に grill-me セッションで確定。
type: project
---
## kagetra_new 設計判断（2026-04-15 確定）

poponta2020/kagetra（Ruby/Sinatra/Backbone.js、10年以上前）の完全リプレイス。競技かるた会向け総合グループウェア。

**Why:** 元アプリの技術スタックが古く、モダンな技術で再構築することで保守性・機能拡張性を確保する。

**How to apply:** 全ての実装判断はこの設計書に基づく。変更が必要な場合はユーザーと合意の上で更新する。

### 主要な設計判断

1. **技術スタック**: Next.js 15 + Hono + PostgreSQL 16 + Drizzle ORM + TypeScript strict
   - 却下: Java/Spring Boot（match-trackerの踏襲は不要）、Vue/Nuxt（エコシステム規模で劣る）
   
2. **アーキテクチャ**: Next.js(フロント+BFF) + Hono(API) の分離構成
   - 却下: Next.jsフルスタック一本（LINE Webhook・AI処理・バッチが制約される）

3. **認証**: LINE認証のみ、招待制、3層権限（管理者/副管理者/一般会員）
   - 却下: メール+パスワード（全員LINE使用前提なので不要）

4. **LINE通知**: 1チャネル1人方式（80チャネル）で月200通無料枠を活用
   - 通知対象は全日本かるた協会登録会員（約50名/年）

5. **AI機能**: Yahoo!JAPAN Mail IMAP連携 → Claude APIで振り分け → 管理者承認 → イベント登録/LINE通知
   - 旅費見積もり: リアルタイム検索（Amadeus + Agoda + 楽天トラベル）、札幌発固定、2案提示

6. **インフラ**: AWS Lightsail $5/月〜、Docker Compose、Lightsail+AI API以外は無料

7. **開発プロセス**: テストファースト（Vitest + Playwright）、CI/CD（GitHub Actions）、Codexレビュー（VS Code拡張、ChatGPTサブスク内、PR作成後にClaudeがプロンプト生成→ユーザーがCodexに依頼）、claude-mem統合

8. **4フェーズ開発**: P1基盤 → P2大会運営 → P3 AI+メール → P4コミュニティ

9. **データ移行**: 一括移行スクリプト、全データ引き継ぎ、旧システムP4完了まで並行稼働

10. **UI**: モバイルファースト、シンプル・ミニマル、日本語のみ。デザイン詳細は別途検討（参考デザインを探してから）
