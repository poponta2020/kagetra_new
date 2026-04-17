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

---

## 2026-04-16 セッション3（Phase 1-4 実装）

### 完了
- **Phase 1-4** (`9911d1e` on `feat/phase-1-4-schedule-attendance`): スケジュール機能（出欠管理+スケジュール）
  - event_attendances テーブル (attend boolean, comment, UNIQUE制約, upsert対応)
  - events テーブル拡張: formalName, official, kind, entryDeadline, internalDeadline, eligibleGrades[], eventGroupId
  - event_groups テーブル (大会グループ: さがみ野大会等)
  - schedule_items テーブル + CRUD (練習/会議/懇親会/その他)
  - users に grade カラム (A/B/C/D/E)
  - Hono API: attendances(出欠upsert+締切チェック), event-groups(CRUD), schedule-items(CRUD)
  - フロント: 大会詳細に出欠セクション、大会フォーム拡張(7フィールド追加)、スケジュール4ページ、ナビ追加
  - Drizzle relations定義 (events, eventGroups, eventAttendances, users, scheduleItems)

### 設計判断（grill-meで確認済み）
- 大会の出欠は参加/不参加のboolean（旧event_choices方式は不採用）
- 未回答 = 不参加扱い
- 会内締切後は一般会員変更不可、管理者のみ変更可
- 締切は2種類: 会内締切(出欠ロック用) + 大会申込締切(管理者リマインド用)
- 参加資格フィルタリング: ユーザーの級 × 大会のeligibleGrades
- 級: A〜Eの5段階、団体戦(team_size)はスコープ外で後日追加
- event_groups: 同名大会の春秋開催等をグループ化
- schedule_items: 大会以外の予定管理(練習等)、kindは一応用意

### 現在のPhase
- Phase 1（基盤）— 1-4 まで完了、1-5(データ移行) と 1-V(最終検証) が残り
- feat/phase-1-4-schedule-attendance ブランチにコミット済み、**未マージ・未push**

### 次回やること
- feat/phase-1-4-schedule-attendance をpush → PR作成 → レビュー → マージ
- マイグレーション生成 (Docker PostgreSQL起動 → pnpm db:generate → pnpm db:push)
- Phase 1-5: データ移行（旧kagetraからの会員+イベント移行）
- Phase 1-V: 最終検証（E2E, CI, スマホ実機確認）

### 備考
- pnpm build の Windows symlink警告は既知問題（EPERM, standalone trace copy）
- attendanceStatusEnum が enums.ts に定義されているが未使用（attend は boolean で実装）→ 次回クリーンアップ可
- API認証ミドルウェアは未実装（x-user-id ヘッダーで仮対応、フロントはServer Actions経由）
