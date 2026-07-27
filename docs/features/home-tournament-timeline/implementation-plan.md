# ホーム「会の出場予定」実装手順書

> 要件成果物は [`design-spec.md`](design-spec.md)（UI リデザインは design-spec が要件成果物＝`/define-feature` は回さない）。
> **視覚の正は [`design-prototype.patch`](design-prototype.patch)**。レイアウトの疑問はこの手順書ではなく patch を読んで解決する。

## スコープ

`/dashboard` の中身を全面置き換える。あいさつ・権限カードは撤去し、「未回答アラート → 今日の大会カード → 出場タイムライン」にする。

- **スキーマ変更なし・migration なし**（既存テーブルの再構成のみ）
- 対象範囲: `apps/web/src/app/(app)/dashboard/` のみ。共通コンポーネント・他画面には触れない

---

## タスク1: プロトタイプの取り込み（DTO・純関数・表示コンポーネント）

- [x] 完了

**依存:** なし

1. worktree のルートで patch を適用する:
   ```
   git apply docs/features/home-tournament-timeline/design-prototype.patch
   ```
   当たらなければ patch を読んで手動移植する（対象は `dashboard/` 配下の新規4ファイル＋`page.tsx` 差し替えのみ）。
2. この時点で `home-timeline-proto-data.ts` と `page.tsx` の DESIGN-PROTO は**まだ残す**（タスク3で消す）。`pnpm dev:web` で `/dashboard?state=normal|today|long|no-alert|empty` が描けることを確認する。
3. `home-timeline-utils.test.ts` を書く:
   - `splitTimelineDate` — 正常（`2026-08-02` → `{md:'8/2', weekday:'日'}`）・ゼロ埋めなし・不正入力の防御的返り値
   - `alertCountdown` — `0` → `本日締切` / `3` → `あと3日` / 負値 → `N日超過`
   - `confidenceLabel` — `confirmed` → `確定` / `hoped` → `希望`

**完了条件:** 5状態が描画でき、`home-timeline-utils` のテストが green。

---

## タスク2: サーバー側の実データ組み立て

**依存:** タスク1

`page.tsx` を Server Component として書き直し、`HomeTimelineData`（`home-timeline-types.ts` の doc コメントが正典）を実クエリから組む。**母集団は数十件規模なのでクエリ本数を固定する**（イベントごとに投げない。`/admin/entries` の `page.tsx` が手本）。

1. `todayStr = todayInJst()`、`viewerUserId = session.user.id`。
2. **母集団**: `event_date >= todayStr` ∧ `status <> 'cancelled'` ∧ `kind = 'individual'`。`edition` → `series` は **leftJoin**（未紐付けを落とさない）。表示名は `entry-board-utils.displayName` を使う。
3. **eligible 会員集合**: `users.is_invited = true` ∧（`eligible_grades` があれば `users.grade ∈ eligible_grades`）。イベント詳細 AC-26 と同じ。級ごとに集合が変わるのでイベント単位で判定する。
   **★これは 5.（希望パス）にのみ使う。4.（確定パス）には適用しない** — 名簿がその大会の出場者の唯一の権威で、現在の級で絞ると昇級者が名簿から消える（design-spec §6）。
4. **確定名簿**: `entry_group_id` 単位で `roster_type='confirmed'` ∧ `superseded_at IS NULL` の版を引き、その `tournament_entry_roster_entries` のうち
   `status IN ('confirmed','carried_up')` ∧ `selection_outcome NOT IN ('waitlisted','rejected')` ∧ `user_id IS NOT NULL` を出場者にする（絞りはこの3条件だけ）。
5. **希望フォールバック**: 確定名簿が無いグループは `event_attendances.attend = true` ∧ eligible 会員 を出場者にする。
6. **出場者0名の大会は落とす**。残りを `eventDate` 昇順に並べ、`todayStr` と一致するものを `today`、それ以降を `upcoming` に振り分ける。
7. **チップ表示名と級**: 表示名は `surname(user.name)`（`@/lib/surname`）。
   級は **確定パス = `tournament_entry_roster_entries.grade`**（＝その大会で出る級。null のときだけ `users.grade` へフォールバック）、**希望パス = `users.grade`**（出欠に級が無いため）。
   `users.grade` で統一しない —— 昇級者が「石狩CD」のカードに `B` チップで出てしまう（design-spec §6）。
8. **未回答アラート**: 自分の級が `eligible_grades` に含まれ、`COALESCE(internal_deadline, entry_deadline)` が `todayStr` 以降かつ7日以内で、自分の `event_attendances` 行が無い大会。基準締切昇順。
9. `export const dynamic = 'force-dynamic'`（`/admin/entries` と同じ）。

**テスト（`page.test.tsx`）:** 確定名簿ありで確定ラベル・補欠/落選/繰上り辞退が出ないこと／確定名簿なしで希望フォールバックすること／**希望パスで**対象級外の stale な `attend=true` が除外されること／**確定パスでは昇級者（`users.grade` が `eligible_grades` 外）が残り、チップの級が名簿行の `grade` になること**／出場者0名の大会が載らないこと／未回答アラートの7日境界（8日前は出ない・7日前と当日は出る・回答済みは出ない）。

**完了条件:** 実データで `/dashboard` が描画でき、上記テストが green。

---

## タスク3: DESIGN-PROTO 撤去・表示テスト・忠実度チェック

**依存:** タスク2

1. `home-timeline-proto-data.ts` を**ファイルごと削除**。`page.tsx` から `searchParams`・状態切替バー・`loadHomeTimeline` の import を撤去。
2. `git grep -n "DESIGN-PROTO"` が **0件**であることを確認する。
3. `HomeTimeline.test.tsx`:
   - 出場予定ゼロで「出場予定の大会はありません」
   - 今日カードあり・upcoming 空で「この先の出場予定はありません」
   - アラート0件で朱の行が描かれない
   - 5件で初期4件＋「もっと見る（残り1件）」、クリックで5件表示・ボタン消滅
   - `viewerUserId` と一致するチップにだけ自分用クラスが付く
4. **design-spec §8 の忠実度チェックリストを1項目ずつ確認する**（375px 実機幅での横スクロールなしを含む）。
5. `docs/features/INDEX.md` は本 PR で追記済み。`docs/SPECIFICATION.md` 配下のドメイン仕様（ホーム画面）に該当セクションがあれば in-place 更新する。

**完了条件:** DESIGN-PROTO 0件・全テスト green・忠実度チェックリスト全項目 ✓。

---

## 注意（既知の罠）

- **`Date.now()` を呼ばない** — `todayStr` はサーバーが渡す（hydration mismatch）
- **Tailwind v4 は未定義トークンを無言で握り潰す** — 新トークンは追加していないが、クラス名をタイポしても build/lint/test が全 green のまま無色化する。仕上げに計算済みスタイルで実効値を検算する
- **`text-ink-meta` を `bg-surface-alt` の上に置かない**（4.16:1）。チップ内の級添え字は `text-neutral-fg`
- **worktree のテスト DB** — `.env` のコピーが要る（`reference_worktree_vitest_db_setup`）
