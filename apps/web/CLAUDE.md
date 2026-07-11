# apps/web — Next.js 15 (App Router)

フロント + BFF。API 実処理はここ（Server Actions + `src/app/api/` ルートハンドラ）にあり、apps/api（Hono）はスケルトン。

## ルート構成 (src/app/)

- `(app)/` — 認証必須のメイン画面群（共通モバイルシェル layout）
  - `dashboard/` ホーム / `events/` イベント出欠・大会申込 / `events-archive/` 過去イベント
  - `players/` 選手検索・戦績詳細・ランキング / `tournaments/` 大会結果閲覧（一覧・詳細・シリーズ・統計）
  - `schedule/` 行事予定 / `admin/` 管理（members・mail-inbox〔結果ドラフト承認含む〕・line-channels） / `settings/` 設定
- `api/` — BFF ルートハンドラ（auth / webhook / line-broadcast / line-link / zip / admin）
- `auth/signin` LINE ログイン / `register/[token]` 招待登録 / `self-identify` 本人紐付け

## src/lib/ 主要モジュール

- `result-import/` — 取込結果の materialize（パーサ本体は apps/mail-worker/src/result-import/）
- `stats/` — 統計クエリ一式（ranking / overview / detail / series / results）
- `players/` — 選手クエリ・display_name 再計算・順位導出（placement）
- `edition/` — 大会シリーズ/開催（edition）マスター解決
- `roster-import/` — 申込/確定名簿の取込
- 単発モジュールはフラット配置でファイル名=責務（line-broadcast, mail-body-*, invite-code 等）。テストは同名 `.test.ts` を隣接配置

## 規約（詳細は .claude/project-profile.md §conventions）

- Server Components + Server Actions で DB 直接操作（Drizzle。接続は `src/lib/db.ts`）
- Server Action / route handler は冒頭で `await auth()` + role チェック必須（admin / vice_admin / member の3層）。データ変更後は `revalidatePath()`
- UI 文言は日本語。Tailwind v4 + shadcn/ui（`src/components/ui/`）。モバイルファースト
- 使い捨て診断スクリプトはリポジトリルートの scripts/diagnostics/ に作る（apps/web 直下への生成禁止）
