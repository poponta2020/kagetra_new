# kagetra_new

競技かるた会向け総合グループウェア。poponta2020/kagetra の完全リプレイス。

## 概要

- 会員100名超、LINE通知対象約50名/年、1人開発(Claude+Codex)
- コスト: Lightsail + AI API以外は無料

## 技術スタック

- Next.js 15 (App Router) + Hono (API) の分離構成、TypeScript strict
- PostgreSQL 16 / Drizzle ORM / Auth.js v5 (LINE認証のみ/招待制)
- Tailwind CSS + shadcn/ui / Vitest + Playwright
- Turborepo + pnpm / Docker Compose on AWS Lightsail
- CI/CD: GitHub Actions (テスト+型チェック+lint+自動デプロイ)
- レビュー: PR作成後 auto-review-loop が Codex CLI で構造化レビュー→`/fix` で自動修正→再レビューを最大3ラウンド回す（手動レビューを使いたい場合のみ `/review` で VS Code Codex に切替）

## 構成

```
apps/web/    → Next.js (フロント+BFF)
apps/api/    → Hono (バックエンドAPI)
packages/shared/ → 共有型定義、Drizzleスキーマ
docker/      → docker-compose.yml, nginx
scripts/migration/ → データ移行
.github/workflows/ → CI/CD
```

## 機能 (4フェーズ)

- P1基盤: プロジェクト構成 / ユーザー管理+LINE認証 / イベント / スケジュール / データ移行(会員+イベント)
- P2大会運営: 試合結果・統計 / LINE通知(1チャネル1人×80) / データ移行(試合結果)
- P3 AI+メール: Yahoo!JAPAN Mail IMAP→Claude API振り分け(管理者承認) / AI大会案内読み込み(PDF/Word) / AI名簿→反映 / AI旅費見積もり(札幌発,Amadeus+Agoda+楽天,2案提示)
- P4コミュニティ: アルバム / BBS / Wiki / アドレス帳 / データ移行(残り全て)
- 権限: 管理者/副管理者/一般会員(3層)
- データ移行: 一括スクリプト、全データ引き継ぎ、旧システムP4完了まで並行稼働
- UI: モバイルファースト、シンプル(デザイン詳細は別途)、日本語のみ

## 開発ルール

1. **実装前確認**: claude-mem検索→曖昧さは確認→make-plan→ユーザー承認。**計画承認後も /do-plan（または素の /claude-mem:do）の明示的な指示があるまで実装を開始しない**。/do-plan は worktree 隔離と並行作業の衝突検知込み（推奨）
2. **テストファースト**: APIテスト→実装→フロントテスト→実装→E2E
3. **1PR=1機能**: 小さく、混ぜない、description(何を・なぜ・テスト方法)必須
4. **claude-mem記録**: 設計判断/バグ修正/完了/フィードバック時に必ず
5. **破壊的変更禁止**: テスト破壊は承認必須、直接ALTER禁止、本番操作は確認
6. **セッションプロトコル**: 開始→git pull→.claude/memory/からローカルmemoryへ同期→docs/worklog.md確認→続きから / 終了→worklog.md追記→ローカルmemoryから.claude/memory/へ同期→コミット→git push
7. **DoD**: 実装完了→テスト(API+フロント+E2E)+CI通過+claude-mem記録→PR作成+Codexレビュー+指摘修正→最終確認(スマホ実機含む)+ship
8. **フェーズ品質ゲート**: 全DoD+移行確認+リグレッションなし+本番確認+総括+次Phase合意
9. **スコープ管理**: Phase外要望はclaude-memに記録、混ぜない。ついでリファクタ禁止
10. **トラブル対応**: 原因確認→修正PRまたはロールバック→インシデント記録
11. **並行作業管理**: セッション開始時にclaude-memで他ブランチの進行状況を確認。worktree作成/削除、マイグレーション番号の衝突回避、shared/の競合チェック、マージ時のリベースは全てClaude側で行う。危険な並行は警告してユーザーに確認を取る

## 開発フロー (1機能)

grill-me(仕様確認) → define-feature(要件定義+計画+Issue) → ユーザー承認 → implement(worktreeで1タスクずつ実装、全タスク完了時に自動連鎖) → prepare-pr(PR作成) → auto-review-loop(Codex CLIで構造化レビュー→/fix修正→再レビュー、最大3ラウンド) → dod(DoDチェック) → ship(マージ+memory同期+push)

実装系スキル（implement / do-plan / quickfix / bug-report / fix-feature）はすべて末尾で次スキルを自動呼び出しし、auto-review-loop まで自動で繋がる。手動 Codex VS Code レビューを使いたい場合のみユーザーが個別に `/review` を呼ぶ。
