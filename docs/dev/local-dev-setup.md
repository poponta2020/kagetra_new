# ローカル動作確認セットアップ

家・会社の 2 環境で kagetra_new アプリをローカル動作確認するための手順と、現時点 (2026-05-07) での進行状況・次のアクションをまとめた引き継ぎ書。

PR #21 (Phase P3-A メール大会取り込み 最終 PR) のマージ後、まだ本番 Lightsail デプロイ前の段階で、開発マシン上で「ログイン → 各画面 → メール取り込み AI 精度確認」の一通りを再現できる状態にすることを目的とする。

---

## 0. 前提

- Windows 11 + Git Bash で動作確認済み（macOS / Linux でも同等手順で動く想定）
- Docker Desktop 4.49+
- Node.js 22.13+ / pnpm 9.15+
- リポジトリ clone 済み

---

## 1. 初回セットアップ

### 1-1. 依存インストール

```bash
pnpm install
```

### 1-2. env ファイル 3 種類

| ファイル | 読み手 | 状態 |
|---|---|---|
| `apps/web/.env.local` | Next.js dev server | ✅ 配置済み (gitignored) |
| `packages/shared/.env` | drizzle-kit (`db:push` 等) | ✅ 配置済み (gitignored) |
| `<repo root>/.env` | mail-worker | ❌ 未作成。実 IMAP / 実 LLM 動作確認時に必要 |

#### `apps/web/.env.local` の内容（テンプレート）

```ini
DATABASE_URL=postgresql://kagetra:kagetra_dev@localhost:5433/kagetra
FRONTEND_URL=http://localhost:3000

# Aligned with apps/web/src/test-utils/playwright-auth.ts so the dev:cookie
# script issues tokens that the dev server can decode.
# ⚠ Production には絶対に使わない。本番デプロイでは必ず別値 (`openssl rand
# -base64 32` 等) を設定する。「test secret が漏れても本番セッション偽造
# できない」という安全性は、production の AUTH_SECRET が dev と異なる前提
# が満たされている時のみ成り立つ。
AUTH_SECRET=e2e-test-secret-do-not-use-in-production

# Real LINE Login channel — primary login + invited-member self-identify flow.
AUTH_LINE_ID=<channel-id>
AUTH_LINE_SECRET=<channel-secret>

# /settings/line-link (account-switch flow). Same channel でも別 channel でも可。
LINE_LOGIN_CHANNEL_ID=dev-placeholder
LINE_LOGIN_CHANNEL_SECRET=dev-placeholder
LINE_LOGIN_CALLBACK_URL=http://localhost:3000/api/line-link/callback

# Re-extract Server Action (admin draft 詳細の「再抽出」ボタン) が呼ぶ AI 用。
# mail-worker と同じキーで OK。未設定なら再抽出ボタンだけ動かない。
ANTHROPIC_API_KEY=
```

#### `packages/shared/.env`

```ini
DATABASE_URL=postgresql://kagetra:kagetra_dev@localhost:5433/kagetra
```

#### `<repo root>/.env` （**未作成**、mail-worker 実行時に作る）

```ini
DATABASE_URL=postgresql://kagetra:kagetra_dev@localhost:5433/kagetra

# https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-...

# Yahoo!JAPAN メール（普通の PW ではなく App Password）
# 発行: https://accounts.yahoo.co.jp/account/manage/security/app-password
# 事前に「IMAP/POP/SMTP アクセス」を「外部メールソフトを許可」へ切替が必要
YAHOO_IMAP_HOST=imap.mail.yahoo.co.jp
YAHOO_IMAP_PORT=993
YAHOO_IMAP_USER=xxxx@yahoo.co.jp
YAHOO_IMAP_APP_PASSWORD=...
```

### 1-3. DB 起動 + schema 適用

```bash
docker compose -f docker/docker-compose.yml up -d db
pnpm --filter @kagetra/shared db:push --force   # TTY 不要にするため --force 必須
```

`--force` は drizzle-kit が「変更を確認するか？」プロンプトを出すのを回避するためで、開発 DB のみで使う。dev DB が空 or 既知のスキーマなら破壊なしで適用される。

---

## 2. ログイン方法 2 種

`/auth/signin` 以下の 2 経路をそれぞれ用意してある。

### 2-A. Cookie 注入 (最速、AI 不要)

LINE Login の OAuth フローを丸ごと迂回し、admin / member 用に dev DB に seed したユーザーで Auth.js JWT を発行してブラウザに直接貼る方式。`AUTH_SECRET` を E2E テストの hardcoded secret (`e2e-test-secret-do-not-use-in-production`) に揃えてあるので、既存 `apps/web/src/test-utils/playwright-auth.ts` のロジックがそのまま流用できる。

```bash
pnpm --filter @kagetra/web dev:cookie                # admin (デフォルト)
pnpm --filter @kagetra/web dev:cookie -- --role=member
pnpm --filter @kagetra/web dev:cookie -- --role=vice_admin --name="副管理 太郎"
```

実装は [apps/web/scripts/dev-issue-cookie.ts](../../apps/web/scripts/dev-issue-cookie.ts)。出力された `document.cookie = "..."` 行を Chrome DevTools Console に貼って Enter → リロードでログイン状態に。

idempotent: 同じ role の既存ユーザー (`dev-admin@kagetra.local` 等) があれば再利用、なければ insert。`--name=...` は新規 insert 時のみ反映され、既存ユーザーの `name` は更新しない（変更したい場合は dev DB で直接 UPDATE するか、対象 email の行を手動削除してから再実行）。

### 2-B. 実 LINE Login

本番に近いフローを試したいときの方式。

1. `apps/web/.env.local` の `AUTH_LINE_ID` / `AUTH_LINE_SECRET` を **本物の LINE Login channel** の値に
2. LINE Developers console (https://developers.line.biz/console/) で対象 channel の **Callback URL** に `http://localhost:3000/api/auth/callback/line` を登録
3. dev server を再起動 (`pnpm dev:web`)
4. `/auth/signin` → 「LINE でログイン」→ 認可 → 戻り
5. 初回ログインなら `/self-identify` に飛ぶ。候補一覧 (`is_invited=true && line_user_id IS NULL`) から自分の名前を選択 → LINE アカウントが users 行に紐付く
6. 以降は `/dashboard` 直行

**dev での LINE Login channel ID/SECRET は `.env.local` (gitignored) に書く**。間違っても commit されないので安心。

---

## 3. メール大会取り込み (mail-worker) の動作確認

### 3-1. 仕組みのおさらい

- 管理 UI `/admin/mail-inbox` の「メール取り込み」ボタンは `mail_worker_jobs` に行を INSERT するだけ
- 実取得は別プロセスの `apps/mail-worker` 担当 (本番は systemd timer 30 分間隔)
- mail-worker が `FOR UPDATE SKIP LOCKED` で job を claim → IMAP 取得 → Anthropic Claude 分類 → tournament なら `tournament_drafts` 保存
- LINE 通知 (新規 draft 件数 + 異常時)
- 結果は `mail_worker_runs` に書かれて UI 上「最近の取り込み履歴」に表示

dev では mail-worker を **手動で 1 回ずつ実行** する形になる (systemd unit は本番のみ)。

### 3-2. 必要 credentials (3 つ)

| Key | 入手元 | 用途 |
|---|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | AI 分類 |
| `YAHOO_IMAP_USER` | あなたの Yahoo!Mail アドレス | IMAP user |
| `YAHOO_IMAP_APP_PASSWORD` | https://accounts.yahoo.co.jp/account/manage/security/app-password | IMAP password |

#### Anthropic API キー発行

1. https://console.anthropic.com/ にログイン
2. **Settings → API keys → Create Key** (`kagetra-dev` 等の名前)
3. 表示された `sk-ant-...` を**その場でコピー** (再表示不可)
4. **Billing → Add credit** で初回 $5 程度入れる (Auto-reload は OFF 推奨)

#### Yahoo!Mail App Password 発行

Yahoo!JAPAN は 2025 年後半から IMAP デフォルト無効化が進んでいるので 2 段階必要:

1. https://accounts.yahoo.co.jp/ にログイン
2. **ログインとセキュリティ → IMAP/POP/SMTP アクセス**: 「外部メールソフトを許可」に切替
3. https://accounts.yahoo.co.jp/account/manage/security/app-password
4. **新しいアプリパスワードを発行する** → アプリ名 `kagetra-dev` 等
5. 16 桁英数字を**その場でコピー** (再表示不可)
6. 不要になったら同画面から削除可能 (Yahoo!ID メイン PW とは別管理)

### 3-3. mail-worker の実行

`<repo root>/.env` に上記 3 つを書いた状態で:

```bash
# 直近 2 日のみ取得（初回お試し、コスト最小）
pnpm --filter @kagetra/mail-worker start --since=2026-05-05

# 1 ヶ月分取得（精度を見たいとき）
pnpm --filter @kagetra/mail-worker start --since=2026-04-01
```

主な CLI フラグ ([apps/mail-worker/src/index.ts](../../apps/mail-worker/src/index.ts)):

| フラグ | 意味 |
|---|---|
| `--since=YYYY-MM-DD` | 取得開始日 (JST 0:00 起点)。省略時は 7 日前 |
| `--mock-imap` | fixture eml ファイルを使う (IMAP credentials 不要) |
| `--mock-llm` | fixture LLM レスポンスを使う (`ANTHROPIC_API_KEY` 不要) |
| `--dry-run` | parse のみで DB / LLM に書き込まない |
| `--fixture-dir=PATH` | `--mock-imap` の eml ディレクトリ |

実行終わるとプロセスが exit する。`/admin/mail-inbox` をリロードすれば取り込み履歴と draft 一覧が見える。

### 3-4. 承認フロー検証

`/admin/mail-inbox/[id]` で各 draft に対して:

- **承認** → `events` に INSERT、draft.status を `approved` へ
- **却下** → 理由付きで `rejected` へ
- **再抽出** → 同じメールを Claude に再投入 (新規 draft 行を作って superseded リンク)
- **既存イベントに紐付ける** → `linked_event_id` を設定

各操作は `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` の Server Action で実装。terminal status (approved/rejected/superseded) からの遷移は guard でブロック。

### 3-5. コスト目安 (Sonnet 4.6, 2026-04 単価)

[apps/mail-worker/src/classify/cost.ts](../../apps/mail-worker/src/classify/cost.ts) より:

- Input: $3 / 1M tok / Output: $15 / 1M tok
- Cache read: $0.30 / 1M tok / Cache write 1h: $6 / 1M tok
- システムプロンプト ~6,000 tok を 1h ephemeral cache してるので 2 通目以降は約 1/10

| メール構成 | 1 通あたり | 1000 円 (≒$6.67) で何通 |
|---|---|---|
| 軽量 (本文のみ) | $0.011 | 約 600 通 |
| 標準 (本文+添付 1) ← 大会案内典型 | $0.018 | 約 360 通 |
| 重め (PDF/Word 複数) | $0.038 | 約 170 通 |
| キャッシュ無効 (cron 単発) | $0.046 | 約 140 通 |

過去 investigation で「2026-04 の 1 ヶ月で 22 通」だったので、**1000 円で 1 年分以上のテストが賄える** 計算。

---

## 4. トラブルシュート

### `drizzle-kit push` が `Interactive prompts require a TTY` で止まる

→ `--force` を付ける (1-3 のコマンド参照)。

### LINE Login で `400 Bad Request: Failed to convert ... clientId`

→ `AUTH_LINE_ID` が数字でない (`dev-placeholder` のまま)。本物の channel ID に置き換えるか、Cookie 注入方式に切替。

### LINE Login で `redirect_uri mismatch`

→ LINE Developers console の channel 設定で Callback URL `http://localhost:3000/api/auth/callback/line` を **完全一致** で登録する (末尾スラッシュ不要、http/https の違いに注意)。

### `/admin/mail-inbox` が `Configuration` エラー

→ session が作れていない。Cookie 注入したつもりが secret 不一致 / Auth.js JWT decode 失敗。`apps/web/.env.local` の `AUTH_SECRET` が `e2e-test-secret-do-not-use-in-production` に揃っているか確認。

### Windows で `next build` が `EPERM` で落ちる

→ standalone trace copy が symlink 権限で失敗する Windows 既知問題。CI (Linux) では起きないので動作確認用途では `next dev` で OK。本番 build は CI / docker に任せる。

---

## 5. 現状 (2026-05-07) と次のアクション

### ✅ 完了

- `apps/web/.env.local` 配置 (Cookie 注入 + 実 LINE Login 両対応)
- `packages/shared/.env` 配置
- DB schema 適用 (migration 0001〜0010)
- dev DB に admin / member 2 ユーザー seed
- `apps/web/scripts/dev-issue-cookie.ts` 新規追加 + `pnpm dev:cookie` script 配線
- 実 LINE Login で `/self-identify` → Dev Admin claim 成功 (土居悠太アカウント)
- `/admin/mail-inbox` の取り込みボタン動作確認（job INSERT のみ、worker 未起動なので draft 生成は未確認）

### 🔜 次のアクション

#### ユーザー側で発行が必要

- [ ] **Anthropic API キー**: https://console.anthropic.com/settings/keys → $5 入金
- [ ] **Yahoo!Mail App Password**: https://accounts.yahoo.co.jp/account/manage/security/app-password (事前に IMAP アクセス許可)

#### Claude 側で credentials 受領後にやる

1. `<repo root>/.env` を新規作成 (上記テンプレート + 受領した値)
2. `apps/web/.env.local` の `ANTHROPIC_API_KEY` も同値で埋める (再抽出ボタン用)
3. **小範囲で初回プローブ**: `pnpm --filter @kagetra/mail-worker start --since=2026-05-05` で直近 2 日
4. `mail_worker_runs` / `tournament_drafts` テーブルの中身を SQL で確認
5. ブラウザで `/admin/mail-inbox` リロード → draft 一覧と AI 抽出値の精度を目視
6. 個別 draft の詳細で **承認 / 却下 / 再抽出 / 既存イベント紐付け** をそれぞれ 1 回試行
7. 問題なければ `--since=2026-04-01` 等で範囲拡大して長期間メールに対する精度を確認
8. 精度・コスト所感をまとめて worklog 追記、不要になったら API キー / app password を revoke

### 📌 carryover (本作業とは別件、今後着手予定)

- 本番 Lightsail への mail-worker 初回デプロイ (`docs/deploy/mail-worker.md`)
- Phase P3-B (LINE グループ転送 + bot コマンド) or P3-C (AI PDF/Word/名簿/旅費見積もり) — grill-me で優先度確定
- carryover Nits (詳細は `docs/worklog.md` 参照): `truncateAiError` の code-point 化, `--since` UTC component 化, `reextract` test の execPath 化, signIn deactivated user 拒否テスト, 対象外参加行の別枠表示

---

## 6. 関連ドキュメント

- [docs/worklog.md](../worklog.md) — セッション間の作業ログ
- [docs/features/mail-tournament-import/](../features/mail-tournament-import/) — PR1〜PR5 の plan / decision
- [docs/deploy/mail-worker.md](../deploy/mail-worker.md) — 本番 systemd デプロイ手順
- [CLAUDE.md](../../CLAUDE.md) — プロジェクト全体の開発ルール
