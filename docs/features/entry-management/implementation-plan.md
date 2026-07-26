---
status: completed
---
# entry-management 実装手順書

要件: [requirements.md](requirements.md) ／ 見た目の正典: [design-spec.md](design-spec.md) + [design-prototype.patch](design-prototype.patch)

**スキーマ変更・migration は発生しない。** すべて既存列・既存テーブルからの導出。

## プロトタイプ patch の扱い（全 UI タスク共通）

patch には**プロトタイプを未ログインで開くための認証バイパスが含まれている**。適用時は必ず次の 2 ファイルを除外すること:

```bash
git apply --exclude=apps/web/src/middleware.ts --exclude='apps/web/src/app/(app)/layout.tsx' docs/features/entry-management/design-prototype.patch
```

除外し忘れると `/admin/entries` が無認証で開ける状態が本番へ出る。適用後は `apps/web/src/app/(app)/admin/entries/page.tsx` の認可ガードも本来の形（コメントに残してある `if (!session || role が admin/vice_admin でない) redirect('/403')`）へ戻す。

完了時に `git grep -n "DESIGN-PROTO"` が **0 件**であることを確認する。

---

## 実装タスク

### タスク1: 仕分けロジックの純関数とテスト（#323）
- [x] 完了
- **目的:** 区画判定・並び順・日付バッジ・強調判定・折りたたみ残留判定を、DB に触れない純関数として確定させ、要件の分岐をすべてユニットテストで固定する。
- **対応AC:** AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-18, AC-19, AC-20, AC-21, AC-21b, AC-27
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts`（patch から取り込み）＋ 同ディレクトリに `entry-board-utils.test.ts` を新規作成
- **依存タスク:** なし
- **必要なテスト（テストファースト）:**
  - `classify` の全分岐 — 5 区画それぞれに入る条件、および非表示 2 条件（`not_applying` / 締切超過かつ参加者 0 名）
  - 境界: `baseDeadline === todayStr` は「締切前」、`< todayStr` で「要対応」または非表示。`baseDeadline` 両方 NULL は「締切前」
  - **相互排他の網羅テスト** — 代表的な入力集合に対し、各大会がちょうど 1 区画に入る（または非表示になる）ことを検証（AC-14）
  - `sortArea` — 区画ごとのキー（会内締切／本締切／抽選日／支払締切／開催日）・NULL 末尾・開催日を副キー
  - `deadlineBadgeOf` — 区画ごとに正しい日付を選ぶこと。特に「要対応」が `entry_deadline` を見ること（`internal_deadline` ではない）
  - 残日数の表示条件 — 超過／本日／あと1〜3日は出る、4 日以上は tone `normal` になる（描画側で落とす）
  - `isDue` / `isAreaHot` — 当日・超過・**NULL（fail-safe）**で true、4 日以上先で false。非行動フェーズは常に false
  - `isPinnedWhenCollapsed` — 「締切前」で 3 日以内なら true、締切未設定は false、他区画は常に false
  - `displayName` — 通称+級、通称 NULL で `title` にフォールバック、級 NULL で級なし
  - `Date.now()` を呼ばないこと（引数 `todayStr` のみで結果が決まる）
- **完了条件:** `pnpm --filter=@kagetra/web test --no-file-parallelism` で新規テストが green、`pnpm check-types` 通過
- **対応Issue:** #323

### タスク2: ボトムナビへの「申込管理」タブ追加（#324）
- [x] 完了
- **目的:** 管理者だけに `/admin/entries` への導線を出す。
- **対応AC:** AC-2, AC-3
- **主な変更領域:** `apps/web/src/components/layout/bottom-nav.tsx`（`TABS` に `adminOnly` の 7 個目を追加。位置は `players`（統計）の直後・`members`（会員）の前）、`apps/web/src/components/layout/bottom-nav.test.tsx`
- **依存タスク:** なし
- **必要なテスト:**
  - **既存 `bottom-nav.test.tsx` はタブ集合を厳密に検証しているため必ず落ちる。これは想定内の変更であり、回帰ではない。** 期待値を 7 タブへ更新する
  - 管理者に 7 タブ、一般会員に 3 タブ（既存 3 つのまま）
  - `/admin/entries` を開いたとき「申込管理」だけが active になり、`/admin/members` 等の他タブが光らないこと
  - 既存 6 タブの id・ラベル・href が変わっていないこと（回帰）
- **完了条件:** `bottom-nav.test.tsx` green、`pnpm check-types` 通過
- **対応Issue:** #324

### タスク3: 毎朝アラートの抽出条件に「参加者1名以上」を追加（#325）
- [x] 完了
- **目的:** 画面の「要対応」と LINE アラートの対象定義を一致させる。
- **対応AC:** AC-28, AC-29
- **主な変更領域:** `apps/web/src/lib/entry-overdue-alert.ts`（既存の相関サブクエリ `attendCountExpr` を `WHERE` 条件へ持ち込む）、`apps/web/src/lib/entry-overdue-alert.test.ts`
- **依存タスク:** なし
- **必要なテスト:**
  - 出欠 0 名の未申込・締切超過大会が対象から外れる（新規）
  - **既存 4 条件が変わっていないこと（回帰）** — `status != 'cancelled'` / `event_date >= 今日` / `entry_status = 'not_applied'` / `COALESCE(internal_deadline, entry_deadline) < 今日`
  - 文面・宛先・「対象 0 件なら送信しない」・`event_lifecycle_notifications` に行を追加しないこと（回帰）
- **完了条件:** 既存・新規テストとも green
- **注意:** このファイルは `apps/web/src/lib/` 直下の共有ホットスポット。**他タスクと同じ Wave に置かない**（Wave 1 内では他 2 タスクと変更領域が直交するため並行可）
- **対応Issue:** #325

### タスク4: 申込管理ボードのデータ取得と画面（#326）
- [x] 完了
- **目的:** `/admin/entries` を実データで動かす。
- **対応AC:** AC-1, AC-4, AC-16, AC-17, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/entries/page.tsx`（Server Component・実クエリ・認可ガード）
  - `apps/web/src/app/(app)/admin/entries/EntryBoardClient.tsx`（patch から productionize）
  - `apps/web/src/app/(app)/admin/entries/proto-data.ts` を**削除**
  - テスト: `page.test.tsx` / `EntryBoardClient.test.tsx` を新規作成
- **依存タスク:** タスク1（`entry-board-utils.ts` の純関数に依存）
- **クエリ設計（3〜4 本。区画ごとに投げない）:**
  1. **母集団 + 通称** — `events` を `event_date >= todayStr` / `status != 'cancelled'` / `kind = 'individual'` で引き、`leftJoin(tournamentSeriesEditions, eq(id, events.editionId))` → `leftJoin(tournamentSeries, eq(id, editions.seriesId))` で `short_name` を同時に取る。**`edition_id` は nullable なので必ず `leftJoin`**（`inner` にすると edition 未紐付けの大会が母集団から消える）。既存の同型 traversal は `apps/web/src/lib/players/queries.ts:165`
  2. **参加希望者数** — `event_attendances` を `attend = true` かつ `inArray(eventId, 母集団ID)` で 1 クエリ取得し JS で集計（`/events` の `page.tsx:45-61` と同じ形。N+1 回避）
  3. **確定名簿の有無** — `tournament_entry_rosters` を `roster_type='confirmed'` かつ `isNull(supersededAt)` かつ `inArray(eventId, 母集団ID)` で取り、`Set<eventId>` に畳む
  - 母集団が 0 件のときは 2・3 を投げない（`inArray` に空配列を渡さない。既知の罠）
  - 取得結果を `EntryBoardItem[]` に畳んでクライアントへ渡す。**プロトタイプのフラット DTO の形を維持する**（タスク1 のテストがそのまま効く）
- **必要なテスト:**
  - 母集団条件 — 団体戦・中止・過去日の大会が出ないこと（AC-4）
  - 通称 — `edition_id` あり（通称表示）／なし（`title` フォールバック）の両方
  - 参加希望者数が `/events` と同じ素通し件数であること（AC-17）
  - 確定名簿判定 — `applicant` 名簿や `superseded_at` 済みでは true にならないこと（AC-13 の結線確認）
  - 認可 — 一般会員が開くと `/403` へリダイレクト（AC-1）
  - 空状態 — 母集団 0 件（画面全体）／区画 0 件（見出し＋「なし」、区画は消えない）（AC-25）
  - 折りたたみ — 「締切前」のみ開閉可・既定は開・畳んでも 3 日以内は残り「ほかN件」が出る（AC-23, AC-24）
  - 強調 — 対象 2 区画のみ・締切到来済み 1 件以上のときだけ（AC-22 含む）
  - 行タップの遷移先が `/events/[id]` であること、状態変更操作が存在しないこと（AC-26）
- **完了条件:** 全テスト green、`pnpm check-types` / `pnpm lint` 通過、`git grep -n "DESIGN-PROTO"` が 0 件
- **対応Issue:** #326

---

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1 (#323) / タスク2 (#324) / タスク3 (#325)**
  互いに依存がなく、変更領域が完全に直交する（`admin/entries/` の純関数 ／ `components/layout/` ／ `lib/entry-overdue-alert.ts`）。
- **Wave 2: タスク4 (#326)**
  タスク1 の純関数に依存。UI タスクなので patch の適用（上記の `--exclude` 必須）はここで行う。

---

## 出荷前の最終確認

- `git grep -n "DESIGN-PROTO"` = 0 件
- `apps/web/src/middleware.ts` と `apps/web/src/app/(app)/layout.tsx` に差分が入っていないこと（`git diff --stat` で確認）
- AC-32（manual）: 本番で管理者が `/admin/entries` を開き、375px の 1 画面に 5 区画が収まっていること・仕分けが実運用の認識と一致することを確認する
