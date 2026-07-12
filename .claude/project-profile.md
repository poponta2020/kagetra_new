# Project Profile — kagetra_new

devflow プラグインのスキルが読む、このプロジェクトの唯一の設定ファイル。

## commands

テスト・lint・typecheck コマンド（gate-dod.sh・/fix・/implement が使用。リポジトリルートから実行される）
<!-- devflow:commands -->
```sh
DEVFLOW_TEST_CMDS=("apps/web/::pnpm --filter=@kagetra/web test" "apps/api/::pnpm --filter=@kagetra/api test" "apps/mail-worker/::pnpm --filter=@kagetra/mail-worker test" "packages/shared/::pnpm test")
DEVFLOW_LINT_CMDS=("pnpm lint")
DEVFLOW_TYPECHECK_CMDS=("pnpm check-types")
DEVFLOW_CI_COVERS=("test" "lint" "typecheck")
```
<!-- /devflow:commands -->

- スコープ付き（`パス::コマンド`）: web のみの差分で mail-worker の flaky スイートを回さない。`packages/shared/` 変更は全パッケージに波及するため全体実行
- `DEVFLOW_CI_COVERS`: CI（test.yml）が lint / check-types / test / e2e を全て実行するため、gate-dod は CI green 時にローカル再実行をスキップする
- E2E: `pnpm test:e2e`（Playwright。テスト DB `pnpm test:db:up` が前提）。ローカルゲートでは実行せず CI が最終網
- 単一パッケージのテストは `pnpm --filter=@kagetra/<pkg> test` で直接指定（turbo 経由は strict env の罠あり）

## run

- Web 起動: `pnpm dev:web`（Next.js。ローカル DB は `docker/docker-compose.yml` の postgres）
- テスト DB: `pnpm test:db:up`（127.0.0.1:5434）→ `pnpm test:db:push`
- 詳細な /verify 用起動レシピは未整備 — 初回の /verify 時に `/run-skill-generator` で整備すること

## worktree

既定（Windows: /c/tmp、Linux: /tmp）。

## branches

- ベースブランチ: `main`（1人開発・保護なし）。機能は `feature/<slug>` ブランチ + PR
- `git push origin main` は `/ship` のセッション終了プロトコル（worklog・memory 同期コミット）で許可済み
- PR マージは `gh pr merge --merge --delete-branch`

## database

- ローカル開発 DB: `docker exec kagetra-db psql`（Docker Compose）
- テスト DB: `127.0.0.1:5434`（`localhost` は IPv6 で ECONNRESET になるため IP 直指定）。並行 worktree は `TEST_DATABASE_URL` で隔離
- スキーマ管理: Drizzle ORM（`pnpm db:generate` / `db:migrate`）。**本番 DB への直接操作・db:push はユーザー確認必須**
- 実装ワーカーの DB 書き込みは**テスト DB 限定**

## prod-logs

本番: Oracle Cloud（`new.hokudaicarta.com`）。デプロイは CI から `scripts/deploy/auto-deploy.sh`（SSH）。本番ログは SSH で確認する。

## design-system

/design-screen（ライブプロトタイピング）用の設定:

- **プロトタイプ preview エントリ:** launch.json の `design-live`（port 3100・cwd=`C:/tmp/design-live/apps/web`）→ http://localhost:3100 。メイン dev（`web`・port 3000）と取り違えないこと
- **design worktree セットアップ:** `ensure-worktree.sh design-live design/<slug>` → メインの `apps/web/.env.local` を worktree の同パスへコピー → worktree ルートで `corepack pnpm install` → DB は launch.json の `postgres` エントリを先に起動（dev DB は読み取り中心・書き込みしない）
- **UI プリミティブ:** `apps/web/src/components/ui/`（shadcn/ui ベース + 共通コンポーネント）。新規要素は既存プリミティブを再利用
- **デザイントークン:** `apps/web` の Tailwind v4 設定・globals.css（色・フォントを発明しない）
- **ブランドガードレール:** モバイルファースト 375px 基準・日本語 UI・絵文字はデータ装飾に使わない（朱色はデータ装飾に使わない等、既存画面の規約に倣う）
- （任意）claude.ai/design プロジェクト名: **Kagetra Design System** — 実機閲覧・アーカイブ用フォールバック

## review-extra

Codex レビュー・code-review に追加するプロジェクト固有観点:
- モノレポ: `apps/web`（Next.js 15 App Router）+ `apps/api`（Hono）+ `packages/shared`（Drizzle ORM + 共有型）
- 認証: Auth.js v5 LINE 認証・招待制・RBAC 3層（admin / vice_admin / member）
- フロントは Server Components + Server Actions で DB 直接操作。Hono API は将来のクライアント用
- Tailwind v4 + shadcn/ui、モバイルファースト。テスト: Vitest + Playwright
- 招待制・身内アプリのため**本人性検証は意図的に省略**されている部分がある（過剰指摘しない）

低リスクパス（trivial 高速パス = Codex effort low・AC 適合チェック条件付きスキップの対象。差分<150行・≤4ファイルで全変更がこの範囲内の場合のみ）:
- `apps/web/src/components/**` — ただし Server Action・DB アクセス・認可判定（`"use server"` / drizzle / `require*Session`）を含むファイルは除く（純粋な表示コンポーネントのみ）
- `docs/**`

高リスクパス（レビュー effort を high に上げる対象）:
- 認証・認可: `auth` / `permission` / `middleware` を含むパス
- LINE 一斉配信: `line` かつ `broadcast` / `notify` / `bot`。Bot プール・招待コード関連
- メールワーカー / AI 振り分け: `apps/mail-worker/**`
- DB スキーマ: `packages/shared/**/schema*`、`**/drizzle/**`、`**/migrations/**`
- P3 課金・外部 API: `amadeus` / `agoda` / `rakuten` / `travel` / `payment` を含むパス

## conventions

task-implementer（実装ワーカー）が厳守する実装規約:
- pnpm + Turborepo monorepo。TypeScript strict
- **repo に prettier 設定は無い** — 周辺コードのスタイル（シングルクォート・セミコロン無し等）を目で見て合わせる。一括フォーマッタをかけない
- ユーザー向けエラーメッセージ・UI 文言は日本語
- Server Action / API は認可ガード必須（`requireAdminSession()` 等の既存パターンを踏襲）。データ変更後は該当パスの `revalidatePath()` 漏れを確認
- 参照ゼロ確認→削除する処理は `FOR UPDATE` で直列化（既存実装を踏襲）
- module-level の状態は `globalThis` に pin する（chunk splitting 対策）
- クライアントから import され得るコードで `node:` import を使わない（Web Crypto グローバルを使う）
- テスト実行: `pnpm --filter` で対象 package を直接指定。vitest は `--no-file-parallelism`
- スキーマ変更・Drizzle migration 生成が必要と判明したら**停止して報告**（main が担当）
- 使い捨て診断スクリプトは `scripts/diagnostics/`（リポジトリルート・gitignore 済）に作る。**apps/ 直下への生成禁止**

UI タスクの追加規約（実害が出た既知バグ。再発させない）:
- ボトムシート/モーダルは `createPortal(document.body)` + 既存の `.modal-overlay-h`（svh ベース）パターンを踏襲
- ビューポート高は vh→dvh→svh のカスケードを**専用クラス**で書く（Tailwind utility の出力順は className の並びで制御不能）
- flex 子で `overflow-y-auto` するコンテナには `min-h-0` 必須
- `min-h-*` と padding は border-box で合算される（必要なら calc）。arbitrary value 内のスペースは `_` でエスケープ
- jsdom は inline style の CSS `env()` を捨てる — テストで検証する値は Tailwind arbitrary value で書く

## docs

docs レジストリ（/quickfix・/implement・/audit-feature・gate-dod.sh が参照）。

**事実タイプ→正典ファイル（1つの事実は1ファイルにのみ書く）:**
- 機能仕様・画面・フロー・API（Server Actions / route handlers） → `docs/spec/<ドメイン>.md`（索引: `docs/SPECIFICATION.md`）
- テーブル定義・enum・リレーション → `docs/design/db.md`（+分割分は `docs/design/db-tables-*.md`。**他ファイルへのカラム定義表の記載禁止**。正は `packages/shared/src/schema/` の Drizzle 定義 — スキーマ変更と同じコミットで更新）
- UI デザイントークン・デザインシステム → `docs/design/design.md`・`docs/design/colors_and_type.css`（claude.ai/design 連携）
- 変更履歴 → `docs/features/<slug>/`（requirements / design-spec / implementation-plan。索引: `docs/features/INDEX.md`。本体 docs への履歴追記禁止）
- 開発プロセス → `docs/dev/feature-flow.md`／モデル委譲 → `docs/dev/model-delegation.md`／ローカル環境 → `docs/dev/local-dev-setup.md`
- データ品質作業の台帳 → `docs/data-quality/`
- 作業ログ → `docs/worklog.md`

**更新手順:** 該当ドメインファイルを特定 → 見出しを Grep → そのセクションだけ in-place 更新（実装と同じコミットに含める）
**書き込み規律:** 1事実1ファイル／見出しに連番を付けない／実装参照はファイルパス粒度（行番号禁止）／長いコード断片のコピー禁止／本文への changelog 追記禁止

gate-dod.sh の D2 チェック用パスパターン:
<!-- devflow:docs -->
```sh
DEVFLOW_SRC_PATTERNS=("apps/web/src/" "apps/mail-worker/src/" "packages/shared/src/")
DEVFLOW_DOCS_PATTERNS=("docs/" "CLAUDE.md" "apps/web/CLAUDE.md")
```
<!-- /devflow:docs -->

## worklog

`docs/worklog.md`（/ship・/auto-review-loop が追記する）
