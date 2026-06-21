# 過去大会結果 一括投入スクリプト — 実装計画

> 2026-06-21 作成（make-plan）。前提は [handoff.md](./handoff.md)。
> Phase 0（事実調査）完了。各フェーズは新しい context で自己完結実行できるよう file:line 付きで記述。

---

## 採用設計（Phase 0 調査に基づく確定事項）

### 方式: 案A（パースと投入の分離）

**c:\tmp のハーネスが payload JSON を出力 → 投入スクリプトが payload JSON ＋ 確定 manifest CSV を読んで `materializeResultDraft` を呼ぶだけ。**

- 採用理由:
  1. ハーネスは既に全116ファイルを（救済込みで）`ParsedClass[]` にパース済み。これは `materialize` の契約そのもの。**救済161行を動かさない＝ミス移植でデータ破損するリスクゼロ**。
  2. `grids_xls.json` に .xls もパース済み → **libreoffice 依存を回避**（案Bは .xls 変換で本番ホスト実行が必須になる）。
  3. 日付・dedup・F級判定は manifest で**人間レビュー済み**（adopt=YES 664 / 開催日 667/667 確定）。再導出しない＝二重の真実源を作らない。
- 案B（救済を scripts/migration/ に移植して Excel から直接パース）は却下: 161行＋日付結合~120行の移植コストとドリフトリスク、libreoffice 依存。
- ⚠ 案Aの弱点（c:\tmp 依存）は、**payload JSON とハーネス一式を `scripts/大会結果取り込み/`（gitignore済）配下にコピー保存**して再現性を確保することで緩和する。

### 確定した型・契約（Phase 0 / 推測なし）

```typescript
// reader: apps/mail-worker/src/result-import/reader.ts:11-16, 98
type CellValue = string | null
type CellGrid  = CellValue[][]
interface SheetData { name: string; grid: CellGrid }
function readExcel(buf: Buffer, filename: string): Promise<SheetData[]>

// parser: apps/mail-worker/src/result-import/parser.ts:14, 352
const PARSER_VERSION = '1.0.0'
function parseResultExcel(sheets: SheetData[]): ParsedClass[]   // payload ではなく ParsedClass[]

// schema: apps/mail-worker/src/result-import/schema.ts:3-43
interface ParsedResultPayload { parserVersion: string; classes: ParsedClass[] }   // ← 2フィールドのみ
interface ParsedClass { className: string; grade: 'A'|'B'|'C'|'D'|'E'|null; sheetName: string|null; participants: ParsedParticipant[] }
// ParsedParticipant: { seqNo, name, nameKana, affiliation, prefecture, dan, memberNo, finalRank, matches[] }
// ParsedMatch: { round, roundLabel, opponentName, scoreDiff, result, status }

// materialize: apps/web/src/lib/result-import/materialize.ts:17-22, 39-43
interface MaterializeOpts { tournamentName: string; eventDate: string|null; venue: string|null; sourceResultDraftId: number }
function materializeResultDraft(tx: DbLike, payload: ParsedResultPayload, opts: MaterializeOpts): Promise<{tournamentId:number}>
// DbLike = NodePgDatabase<typeof schema>。db.transaction(async (tx) => materializeResultDraft(tx, ...)) で呼ぶ。
```

- 呼び出しお手本: **reader→parser** = `run.ts:97-104` / **transaction→materialize** = `apps/web/src/app/(app)/admin/mail-inbox/actions.ts:1415-1448`。
- `materialize` は `payload.classes` のみ使用（`parserVersion` は未使用）→ 救済クラスを包む payload の `parserVersion` は任意の sentinel（例 `'bulk-import-2025'`）でよい。

### 投入の期待値（read-back 照合用）

| 指標 | 期待値 | 出所 |
|---|---|---|
| tournaments 行 | **127**（adopt=YES の instance_key ユニーク数） | manifest 集計 |
| participants 行 | ≈ **30,725** から F級8行分を引いた値 | players列合計、payload生成時に確定 |
| matches 行 | ≈ **63,743** から F級8行分を引いた値 | matches列合計、payload生成時に確定 |
| players 行 | 30,725 未満（同姓同名 get-or-create で集約されるため不定） | — |

### 確定した制約

- **対象**: `adopt=YES` かつ **非F級** のみ。DUP-SKIP 3行は自動除外。
- **F級除外条件**: `grade` 空（null）かつ `className` に `F` を含む 8行（椿杯/静岡58/静岡59 の `対戦結果表_F級`、杉並 `F1`〜`F5`）。grade列に "F" は1件も無いので **className ベースで判定**。
- **グルーピング**: 必ず `instance_key = (tournament_name, event_date)` で束ねて **1インスタンス=1 `materializeResultDraft` 呼び出し**。
  - 1ファイルが複数日に割れる例 14件（北國84 / 近江神宮74 / 大阪107 / 大垣13 / 岡山15 / 青森2 / 奈良34 / 太宰府54 / 女流57 / 京都76 ほか）。
  - 1インスタンスが複数ファイルに跨る例 2件（高等学校選手権個人戦|2025-07-21 が3ファイル、大分53|2025-09-21 が2ファイル）→ classes をマージ。
- **冪等**: `materialize` は tournament を毎回 INSERT（get-or-create でない）→ **投入スクリプト側で「同一 (name, event_date) が既存ならスキップ」** を実装。
- **`sourceResultDraftId`**: 型 `number`（必須）だが DBカラムは nullable → **`number | null` に緩める1行変更**が要る（非破壊）。投入は `null` を渡す。
- **venue**: JKA テーブルにも会場フィールド無し → **全インスタンス `venue: null`**。

---

## Phase 1: 本番コード最小変更（materialize 型緩和）

**What:**
- `apps/web/src/lib/result-import/materialize.ts:21` の `MaterializeOpts.sourceResultDraftId: number` を `number | null` に変更（1行）。
- `tournaments` INSERT の `sourceResultDraftId: opts.sourceResultDraftId`（同ファイル:51）はそのまま（DBカラム nullable なので null OK）。

**Doc references:** materialize.ts:17-22, 51。DBスキーマ `tournaments.source_result_draft_id nullable`（handoff §DBスキーマ）。

**Verification:**
- `pnpm --filter @kagetra/web typecheck`（または turbo typecheck）が green。
- 既存呼び出し `actions.ts:1444` は `sourceResultDraftId: draftId`（number）を渡す→ `number | null` に代入可で**非破壊**を確認（grep で他の呼び出し箇所が無いことも確認）。

**Anti-patterns:** materialize 本体のロジック（players upsert / opponent 解決）には一切触れない。型注釈1箇所のみ。

---

## Phase 2: ハーネス改造（payload JSON 出力）— c:\tmp

**What:** `C:\tmp\make-manifest.mjs` を改造し、**adopt=YES・非F のクラスを instance_key 単位でマージした payload JSON** を出力する。

1. パースループ（`make-manifest.mjs:386-391`）で得た `classes`（`ParsedClass[]`）を捨てずに、各クラスを `{ instanceKey, adopt, grade, className, cls }` で保持する配列に push（現状 `rows.push` は件数のみ＝421-430）。
2. 最後（CSV 書き出し `:487` 付近）で:
   - `adopt === 'YES'` かつ **F級でない**（grade==null かつ className が F* でない）クラスのみ抽出。
   - `instanceKey = ${nameKey}|${date}` でグループ化（既存の instances map:468-469 を流用）。
   - 各 instance について `{ instanceKey, tournamentName, eventDate, venue: null, payload: { parserVersion: 'bulk-import-2025', classes: [...マージした ParsedClass] } }` を構築。
   - 配列を `scripts/大会結果取り込み/2025年_payload.json`（gitignore済）に `writeFileSync(JSON.stringify(..., null, 0))`。
   - 同時に **集計** を出力: instance数（=127 期待）、participants 総数、matches 総数（read-back 期待値＝F級除外後の確定値）。
3. **再現性確保**: `make-manifest.mjs` / `ni_parser.ts` / `ni_normalize.ts` / `jka-dates-2025.mjs` / `grids.json` / `grids_xls.json` を `scripts/大会結果取り込み/harness/`（gitignore済）にコピー。

**Doc references:** 救済 dispatch `make-manifest.mjs:386-391`、payload 保持点 421-430、instances map 468-469、F級8行（manifest 集計）。

**Verification:**
- `2025年_payload.json` の instance 数が **127**。
- payload 内 participants 合計・matches 合計を算出し、ログ出力（Phase 4 の read-back 期待値として記録）。
- payload 内に F級クラス（className が F*）が **0件**であることを grep 確認。
- スポット: 複数ファイルに跨る `大分53|2025-09-21` が AB+CDE 全級を1 payload に持つこと、`高等学校選手権個人戦|2025-07-21` が3ファイル分マージされていることを確認。

**Anti-patterns:** ハーネスの救済ロジック（221-381）・日付結合（68-151）には触れない。payload 出力の追加のみ。実名データを含む JSON を git に commit しない（gitignore 済を確認）。

---

## Phase 3: 投入スクリプト本体

**What:** `apps/web/scripts/import-past-results.ts` を新規作成（配置は §未決1 でユーザー確認）。

- 雛形: `apps/web/scripts/cleanup-expired-tokens.ts:1-104`（Pool 構築・dotenv・`--dry-run`・`import.meta.url` entrypoint guard 全部入り）。
- DB接続: `apps/web/src/lib/db.ts` パターン（`drizzle(new Pool({connectionString: process.env.DATABASE_URL}), { schema })`）。
- 処理:
  1. `2025年_payload.json` を読む（instance 配列）。
  2. （任意で）`2025年_manifest.csv` と件数照合してガード。
  3. 各 instance について `db.transaction(async (tx) => { ... })`:
     - **冪等ガード**: `SELECT id FROM tournaments WHERE name = $1 AND event_date = $2`（NULL 比較注意）が存在すれば **skip**（ログ）。
     - 無ければ `materializeResultDraft(tx, instance.payload, { tournamentName, eventDate, venue: null, sourceResultDraftId: null })`。
  4. `--dry-run` 時は transaction を張らず（または最後に rollback）、「投入予定 instance 数・participants/matches 概算」を出力して**書き込みなし**。
  5. 集計ログ: 投入 instance 数、skip 数、participants/matches 合計。

**Doc references:** cleanup-expired-tokens.ts（雛形）、actions.ts:1415-1448（transaction→materialize お手本）、materialize.ts:39-43。

**Verification:**
- `pnpm --filter @kagetra/web exec tsx scripts/import-past-results.ts --dry-run`（**ローカル DB 相手**）でエラーなく「127 instance 投入予定」サマリが出る。
- typecheck green。

**Anti-patterns:** materialize を tx 外で呼ばない（必ず `db.transaction` 内）。1インスタンスを複数回 materialize しない。冪等ガードの NULL 安全（`event_date IS NULL` の扱い）を忘れない。

---

## Phase 4: コピーDBリハーサル＋read-back（本番DBは触らない）

**What:** 本番の複製DBに対して全件投入し、件数を照合する。

1. **本番バックアップ取得**: 本番ホストで
   `docker compose -f docker/docker-compose.prod.yml exec -T postgres pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl > /tmp/kagetra-YYYYMMDD.dump`
2. **コピーDB作成**: 同 Postgres コンテナ内に別DB（例 `kagetra_rehearsal`）を `CREATE DATABASE` → `pg_restore -d kagetra_rehearsal`。
3. 投入スクリプトを `DATABASE_URL=.../kagetra_rehearsal` で実行（本番ホスト or SSHトンネル）。
4. **read-back 照合**:
   - `SELECT count(*) FROM tournaments` = **127**
   - `SELECT count(*) FROM tournament_participants` = Phase 2 で確定した期待値
   - `SELECT count(*) FROM matches` = Phase 2 で確定した期待値
   - 戦績スポット: 特定大会（例 大分53）の class 構成・ある選手の対戦相手解決を目視。
5. **冪等確認**: 同スクリプトを2回目実行 → 全 instance skip（追加0）を確認。
6. コピーDB は破棄（`DROP DATABASE kagetra_rehearsal`）。

**Doc references:** backup.sh:180-183（pg_dump）、docs/deploy/backup.md:324-327（pg_restore --clean --if-exists）、:337（別DB確認推奨）。

**Verification:** 上記 read-back の3件数が期待値と一致。2回目実行で追加0。

**Anti-patterns:** 本番DB（`kagetra`）に対して実行しない。リハーサルは必ず別DB名。

---

## Phase 5: 本番投入（ユーザー確認必須）

**What:**
1. 本番バックアップを再取得（直前の状態を確保）。
2. **本番DB相手に `--dry-run`** → 「127 instance 投入予定・既存0 skip」サマリをユーザーに提示。
3. **ユーザーの明示 GO を得る**（本番書き込みは確認必須）。
4. 投入スクリプトを本番 `DATABASE_URL` で実行（開催単位 tx）。
5. **read-back**: tournaments=127、participants/matches=期待値、を本番DBで照合（`docker exec kagetra-postgres psql ...` で確認、初回疎通と同じ経路）。
6. 戦績スポット確認。

**Verification:** read-back 3件数一致＋スポット目視。投入前0→投入後127 の差分を確認。

**Anti-patterns:** ユーザー GO 前に本番書き込みしない。dry-run を飛ばさない。

---

## Phase 6: 検証・記録

- 最終件数照合の結果を worklog に記録。
- claude-mem に「一括投入 完了（件数・方式・残課題）」を記録。handoff.md / project_bulk_result_import_design を更新。
- 残課題: 札幌 PDF 2件（別途）、熊本票0件取り込みバグ（別 issue）、表記揺れ4組の名寄せ（保留中）。

---

## ユーザー確認が必要な設計分岐（実装前）

1. **投入スクリプトの配置**: `apps/web/scripts/import-past-results.ts`（推奨。materialize と同パッケージで import が素直・tsx で即実行・雛形あり）か、handoff 当初案の `scripts/migration/`（パッケージ外でパス解決が面倒）か。
2. **案A 採用の最終確認**（パース/投入の分離）。
3. （確認不要・確定）venue=null、F級除外、sourceResultDraftId 型緩和、冪等ガード。
