# Work Log

セッション間・マシン間で作業状況を共有するためのログ。claude-memのローカルDBを補完し、どのマシンからでも前回の続きが分かるようにする。

---

## 2026-04-15 セッション1（設計すり合わせ）

### 完了
- grill-me で全設計判断を確定（Q1〜Q17）
- CLAUDE.md 作成（55行、開発ルール11条含む）
- CONTRIBUTING.md 作成（開発者ルールブック）
- memory ファイル作成（設計判断、開発ルール、ユーザープロフィール）
- memory のリポジトリ内原本 + マシン間同期の仕組みを整備

### 現在のPhase
- Phase 1（基盤）— 未着手

### 次回やること
- Phase 1 の make-plan 実行
- UIデザインの参考資料探し（別途）

### 備考
- データ量（写真枚数、イベント件数等）は後日ユーザーが確認予定
- UIデザインは参考デザインを見つけてから詳細検討

---

## 2026-04-15 セッション2（Phase 1 実装開始）

### 完了
- **Phase 1-1** (`c35d1b0`): モノレポ基盤構築
  - Turborepo v2 + pnpm, Next.js 15, Hono v4, Drizzle ORM
  - Tailwind v4, shadcn/ui準備, Docker PostgreSQL 16
  - GitHub Actions CI, 共有tsconfig, JIT方式の共有パッケージ
- **Phase 1-2** (`cda035e`): ユーザー管理+LINE認証
  - Auth.js v5 + LINE組み込みプロバイダー, DrizzleAdapter
  - 招待制(signInコールバック), databaseセッション, RBAC 3層
  - ログイン/ダッシュボード/会員管理ページ
- **Phase 1-3** (`d415549`): イベント機能
  - events テーブル + CRUD API (Hono + Zod)
  - イベント一覧/詳細/作成/編集ページ (Server Components + Server Actions)
  - Hono RPC クライアント, ナビゲーションバー

### 発見・修正した問題
- PostgreSQL ポート競合 → Docker を 5433 にリマップ
- lineUserId がDBに書き込まれないバグ → linkAccountイベントで修正
- ESM/CJS モジュール不整合 → packages/shared に "type": "module" + bundler moduleResolution
- API の NaN ガード欠如 → 全 :id ルートに isNaN チェック追加
- edit ページの hidden field 改ざん脆弱性 → URL パラメータ使用に修正

### 現在のPhase
- Phase 1（基盤）— 1-3 まで完了、1-4 と 1-5 が残り

### 次回やること
- Phase 1-4: スケジュール機能（イベント×会員の出欠管理）
- Phase 1-5: データ移行（旧kagetraからの会員+イベント移行）
- Phase 1-V: 最終検証（E2E, CI, スマホ実機確認）
- API認証ミドルウェア（Hono側）の追加検討
- サーバーアクション入力バリデーション強化

### 備考
- Docker PostgreSQL は port 5433 で稼働中（ローカル5432と競合回避）
- next lint は deprecated 警告あり（Next.js 16で廃止予定、ESLint CLIへ移行予定）
- API ルートは現在認証なし（フロントはServer Components経由で直接DB接続、APIは将来のクライアント用）
