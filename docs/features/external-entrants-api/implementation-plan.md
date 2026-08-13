---
status: completed
---
# external-entrants-api 実装手順書

要件: [requirements.md](requirements.md)（AC §4）。UI なし（design-spec なし）。

## 技術設計の要点（deep-advisor 相談反映済み）

- **エンドポイント**: `GET /api/external/tournament-entrants`（`apps/web/src/app/api/external/tournament-entrants/route.ts`）。`export const runtime = 'nodejs'` + `export const dynamic = 'force-dynamic'`（**必須** — GET のみの route handler は静的最適化でビルド時に DB 接続しに行く）。成功レスポンスに `Cache-Control: no-store`。
- **認証**: 静的キー `EXTERNAL_ENTRANTS_API_KEY` を `Authorization: Bearer` で受ける。検証は lib 純関数に切り出し、`line-webhook-handler.ts` の `verifyLineSignature` と同形（長さ不一致 early return → try/catch 内 `timingSafeEqual`。server-only lib なので `node:crypto` 可）。**env が未設定・空文字なら比較前に 401**（空文字同士の一致で素通りする罠を塞ぐ。fail-closed）。`process.env` は**ハンドラ関数内で読む**（モジュールトップで読むとビルド時固定される — `(app)/layout.tsx` の実績コメント参照）。キーの受け渡しは Authorization ヘッダのみ（URL クエリは nginx access log に残るため契約で禁止）。
- **middleware**: matcher 除外リストへ `api/external` を追加（プレフィックスマッチ。この名前空間には外部連携ルート以外を作らない）。ガードはルート内 API キー検証が全部担う。
- **導出共通化**: `dashboard/page.tsx` の①〜⑤（イベント・出欠・確定名簿・名簿行・invited ユーザー）＋組み立てを `apps/web/src/lib/upcoming-entrants.ts` へ切り出す。
  - 入力: `{ since: 'YYYY-MM-DD' }`。dashboard は `todayInJst()`、API は当月1日（`todayInJst().slice(0, 8) + '01'`）。
  - 返り値はイベント単位（0名イベントも含めて返し、消費側でフィルタ）。entrant はフルネーム＋かな＋ `entryGrade`（名簿行の級）と `userGrade`（現在の級）を**分離して**持つ（dashboard チップは `entryGrade ?? userGrade`、API の `persons.grade` は `userGrade` — 混ぜると契約が壊れる）＋ `basis: 'roster' | 'attendance'`。
  - `surname()` 化・`sortEntrants` は表示関心なので dashboard 側に残す。
  - 移し漏れ注意3点: 名簿行の `ne(users.role, 'guest')`（AC-3）／同一グループ複数確定名簿の byUserId dedupe／`dedupeByUserId` の先勝ち順序（会員側を先に spread）。
  - 出欠クエリは共有モジュール側で `attend=true` に絞ってよい（現行が絞らないのは未回答アラートとの二役のため）。アラート用は page.tsx に viewer スコープ別クエリ（`eventId ∈ ids ∧ userId = viewer`、**attend では絞らない**）を残して `answeredEventIds` と等価に保つ。
- **シリアライズ**: persons は userId で束ね `name` の ja ロケール昇順、entries は `eventDate` 昇順。`displayName` は `entry-board-utils` の純関数を再利用（再実装禁止）。`confidence` は basis から導出（roster→`confirmed` / attendance→`hoped`）。
- **本番配備（ship 後の残 DoD・手動）**: `openssl rand -base64 32` 相当で生成したキーを本番 `/opt/kagetra/.env.production` へ追記（systemd EnvironmentFile なので**実行時**読み・ビルド再実行不要）→ `systemctl restart kagetra-web.service` → キー無し 401 / 正キー 200 を curl で確認。**キー未設定の間も常に 401 なので、コードが先に出荷されても安全**（デプロイ順序の制約なし）。match-tracker 側へのキー共有（Render env var）はあちらの実装時。

## 実装タスク

### タスク1: 出場者導出の共通モジュール化（純リファクタ）（#491）
- [x] 完了
- **目的:** ホームの出場者導出を API と共有できる形に切り出し、ホームの挙動を変えない
- **対応AC:** AC-10（基盤）, AC-11
- **主な変更領域:** `apps/web/src/lib/upcoming-entrants.ts`（新規・隣接テスト同時作成）, `apps/web/src/app/(app)/dashboard/page.tsx`
- **依存タスク:** なし（共有ホットスポット。単独 Wave で先行）
- **必要なテスト:** 新モジュールのユニットテスト（確定パス・希望パス・ゲスト合流・dedupe・since 境界。DB-backed、`test-utils/seed` 再利用）。**既存 `page.test.tsx` は無変更のまま green を維持**（回帰網）
- **完了条件:** `pnpm --filter=@kagetra/web test` 対象スイート green・typecheck 通過・page.test.tsx 無変更

### タスク2: API ルート新設（認証・シリアライズ・テスト）（#492）
- [ ] 完了
- **目的:** AC-1〜AC-10 を満たす読み取り専用エンドポイントの提供
- **対応AC:** AC-1〜AC-10
- **主な変更領域:** `apps/web/src/app/api/external/tournament-entrants/route.ts`（新規）, `apps/web/src/lib/external-api-key.ts`（新規・キー検証純関数＋隣接テスト）
- **依存タスク:** タスク1
- **必要なテスト:** `external-api-key.test.ts`（`vi.stubEnv`。正キー・不一致・欠落・**env 空文字×空 Bearer の 401**）／`route.test.ts`（DB-backed。契約形・401 変種・名簿/出欠/ゲスト各集合・当月境界(JST)・team/cancelled 除外・dedupe・PII 非含有・共有モジュール出力との集合一致=AC-10）
- **完了条件:** 上記テスト green・typecheck 通過

### タスク3: middleware matcher 除外 + env example（#493）
- [ ] 完了
- **目的:** 新ルートがセッション認証へリダイレクトされず到達可能になる
- **対応AC:** AC-1（到達性の前提）
- **主な変更領域:** `apps/web/src/middleware.ts`（matcher に `api/external` 追加＋既存流儀の理由コメント）, `apps/web/src/middleware.test.ts`（matcher 正規表現が `/api/external/tournament-entrants` を除外することの回帰テスト追加）, `apps/web/.env.local.example`（`EXTERNAL_ENTRANTS_API_KEY` 追記）
- **依存タスク:** なし（タスク2と変更ファイルが直交）
- **必要なテスト:** matcher 除外の回帰テスト（既存のハンドラ直呼びテストは壊れない）
- **完了条件:** middleware.test.ts green・typecheck 通過

### タスク4: 契約ドキュメント（external-api ドメイン新設）（#494）
- [ ] 完了
- **目的:** match-tracker 側実装が参照する公開契約の正典を docs レジストリに置く
- **対応AC:** —（docs。gate-dod D2 対応）
- **主な変更領域:** `docs/spec/external-api.md`（新規: レスポンス JSON スキーマ・認証・「キーを URL クエリで渡さない」・鍵管理と本番配備手順・キー未設定=fail-closed・将来のローテはカンマ区切り複数キー許容で無停止化できる旨のメモ）, `docs/SPECIFICATION.md`（索引行追加）, `docs/features/INDEX.md`（主要領域を確定値へ更新）
- **依存タスク:** なし（docs のみ）
- **必要なテスト:** なし
- **完了条件:** docs レジストリ規律（1事実1ファイル・行番号参照禁止）に適合

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1（共有ホットスポットの単独先行。dashboard/page.tsx と新 lib を確定させる）
- Wave 2: タスク2, タスク3, タスク4（互いに依存なし・変更ファイルが直交）

## 残 DoD（ship 後の本番手作業。手順は上記「本番配備」参照）

- [ ] 本番 `.env.production` へ `EXTERNAL_ENTRANTS_API_KEY` 追記 + `kagetra-web.service` restart + curl で 401/200 確認
