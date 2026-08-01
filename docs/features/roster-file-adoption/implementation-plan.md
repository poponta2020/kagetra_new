---
status: completed
---
# roster-file-adoption 実装手順書（2026-08-01 改修: 級別採用・候補フィルタ・パースUI退役）

要件: `docs/features/roster-file-adoption/requirements.md`（AC は §4。2026-08-01 の delta で上書き済み）
親Issue: #433

初版（2026-07-29 出荷・PR #409）のタスクは git 履歴が保持する。本書は今回の改修タスクで上書き。

## 技術設計の要点（deep-advisor 検証済み）

### データモデル: `tournament_entry_roster_files.grades` 列を追加（案A）

```
grades  grade[]  NULL   -- NULL = グループ統一（既存行は無変換でこの解釈）
                        -- ['D'] = D級 / ['A','B'] = A・B級（複数級カバー）
```

- 前例 `events.eligible_grades`（gradeEnum array）と同型。ORM 経由の enum array は既知罠なし
  （feedback_drizzle_sql_int_array_binding の罠は raw SQL バインド限定。今回 grades を SQL
  パラメータにする箇所は無い — カバレッジ判定は TS 側・表示はラベル連結のみ）。
- junction 表は棄却: 読み手3箇所すべてに JOIN+集約が入り、deleteGroupIfEmpty の依存表も増える
  一方、級単位 UNIQUE や SQL 級検索を使う要件が無い。
- `UNIQUE(source_attachment_id)` 維持（複数級カバーは 1 行の grades 配列で表現）。
- ボードの hasConfirmedRoster クエリ（`/admin/entries/page.tsx` の groupIdsWithConfirmedRoster）は
  grades を見ない select のまま**無変更** — 「級別行も1行として数える」が構造的に守られる。
- **保存時に grades を dedupe + A→E 昇順ソートで正規化**（ラベル生成が単純になる）。
- migration 0053。★enum array の ADD COLUMN は生成実績が無いため、db:generate 後に SQL を目視確認。

### 候補データフロー: サーバー集約 → クライアント純関数フィルタ

`/admin/entries` と同型（page.tsx が表示名等を1回計算して平らな値で渡し、純関数が仕分け）。

- サーバー（`mail/[id]/page.tsx`）: `loadRosterAdoptableGroups()` — 候補グループの平ら DTO を渡す。
  - 母集団: **同一 event 行**で `kind='individual' AND status<>'cancelled' AND event_date>=cutoff`
    を満たす日を1つ以上持つ entry_group（★AND を別 EXISTS に分けない — 「団体戦だけが cutoff 内」
    のグループが通る穴になる）。
  - 各グループ: groupId / 表示名（`deriveEntryGroupName` + 代表イベント title フォールバック。
    `listMergeCandidateGroups` と同型。**サーバーで文字列に済ませる**）/ 日別最小行
    （eventDate・entryStatus・eligibleGrades）/ 採用状況（rosterType × grades|null の行リスト）。
  - 級別の「申込済み」判定は**サーバーで前計算しない** — 日別行を渡し純関数側で計算
    （4象限表のテストを純関数1箇所に集約する）。
- クライアント: **leaf 純関数モジュール** `roster-adopt-utils.ts` が 4象限フィルタ＋トグルを計算。
  ★`'use client'` の Sheet から import されるため、`@kagetra/shared/schema` / `@/lib/entry-groups`
  （drizzle 値 import）を**絶対に import しない**（client バンドルへの DB 依存漏れは build まで
  検知されない — entry-board-utils.ts:16-25 に文書化済みの罠）。型は type-only import で。
- 純関数内で `Date.now()` を読まない（cutoff・todayStr はサーバー注入。既存規約）。

### 候補フィルタ規則（requirements §3.2.7 の実装形）

グループ g、種別 T、グループの級集合 G(g) = 個人戦・非cancelled 日の eligibleGrades 和集合:

- 統一候補: applied(g) ∧ ¬統一ファイル(g,T) ∧ ¬(G(g)≠∅ ∧ G(g) ⊆ 級ファイル和集合(g,T))
- 級別候補 (g,gr): gr∈G(g) ∧ appliedGrade(g,gr) ∧ gr∉級ファイル和集合(g,T) ∧ ¬統一ファイル(g,T)
- applied(g) = いずれかの日が entry_status='applied'。appliedGrade(g,gr) = gr を eligibleGrades に
  含む日のいずれかが applied。
- 「すべて表示」= 基本条件のみ（統一: 全候補グループ / 級別: 全 (g, gr∈G(g))）。

### Server Action: `adoptRosterFile(attachmentId, entryGroupId, rosterType, grades, publishedAt)`

- 旧 eventId 引数を entryGroupId + `grades: Grade[] | null` に変更（呼び出し元は Sheet のみ。
  既存テスト actions.roster-file-adoption.test.ts は書き換え必須）。
- 検証（基本条件のみ。候補フィルタは強制しない = AC-17）:
  1. **grades 入力検証を冒頭で**: null（統一）または非空配列。`⊆ {A..E}`・dedupe・昇順正規化。
     **空配列は明示エラー**（「級別を選んだが級未選択」を統一採用として通さない）。
  2. グループ実在 + 基本条件の日1つ以上（同一行 AND）。
  3. 級別時: 指定級 ⊆ G(g)（個人戦・非cancelled の和集合。**cutoff は掛けない** — §3.2.1 の文言
     どおり独立条件。全日 eligibleGrades NULL なら G=∅ で自然に弾かれる = AC-19）。
  4. 添付実在・未採用（既存 UNIQUE + 事前チェック）。
- **FK violation (23503) を捕捉**して日本語メッセージへ変換（entryGroupId が直指定になったため、
  並行の deleteGroupIfEmpty と競合すると INSERT の RESTRICT FK チェックが生エラーで返る。
  isUniqueViolation と並べて処理）。
- `revalidateRosterFileGroupEvents` は committedEntryGroupId ベースなので無変更で使える。

### パース取込 UI の退役

- `mail/[id]/page.tsx` の「大会名簿の取込」セクション（RosterParseButton・名簿ドラフトカード・
  roster-drafts リンク）を削除し、不要になった page 内のデータ組み立て（rosterSources 等）も落とす。
- **コードは温存**: RosterParseButton.tsx / roster-drafts ページ一式 / triggerRosterParse・承認・
  却下 Server Action / パーサ / テーブル / 既存テストは一切触らない（AC-21）。

---

## 実装タスク

### タスク1: スキーマ `grades` 列＋マイグレーション（共有ホットスポット）— Issue #434
- [x] 完了（migration は **0054**。0053 は payment_deadline_kind で既使用のため採番がずれた）
- **目的:** 級別採用を表現する grades 配列列を追加する
- **対応AC:** AC-12, AC-22（既存行 NULL=統一の互換）
- **主な変更領域:** `packages/shared/src/schema/tournament-entry-roster-files.ts`、
  `packages/shared/drizzle/0053_*.sql`（`pnpm --filter @kagetra/shared db:generate` で生成。
  ★enum array の ADD COLUMN が意図どおりか SQL を目視確認）、`packages/shared/__tests__/` の
  スキーマテスト更新
- **依存タスク:** なし
- **必要なテスト:** スキーマテスト（grades 列の型・nullable・既存 UNIQUE/INDEX が不変）
- **完了条件:** テスト green・`check-types` 通過・migration が journal 経路で空 DB に適用できる

### タスク2: 候補フィルタ純関数（leaf モジュール）— Issue #435
- [x] 完了
- **目的:** 4象限フィルタ＋「すべて表示」＋級列挙・申込判定を純関数で実装する
- **対応AC:** AC-14, AC-15, AC-16, AC-17（フィルタ計算）, AC-19（級列挙）
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/roster-adopt-utils.ts`（新規。
  **DB 非依存 leaf** — 値 import は不可、型のみ）、同 `.test.ts`
- **依存タスク:** なし（型は自前定義の平ら DTO。schema 型に依存させない）
- **必要なテスト:** 4象限それぞれの出す/出さない（申込未・統一済み・全級カバー済み・一部級済み・
  級情報なしグループ・確定候補が applicant ファイル有無に依らないこと・トグルで全件）
- **完了条件:** テスト green・`check-types`・lint 通過

### タスク3: adoptRosterFile シグネチャ変更＋検証強化 — Issue #436
- [x] 完了
- **目的:** entryGroupId + grades 指定の採用に対応し、基本条件検証をグループ単位に置き換える
- **対応AC:** AC-1, AC-2, AC-11, AC-17（フィルタ非強制）, AC-19（級⊆G(g) 検証）
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（adoptRosterFile。
  releaseRosterFile は不変）、`actions.roster-file-adoption.test.ts`（eventId 前提を書き換え）
- **依存タスク:** タスク1
- **必要なテスト:** 権限拒否 / 統一採用 / 級別採用（正規化保存）/ 空配列エラー / 不正級エラー /
  級⊆G(g) 違反 / 基本条件（個人戦・cancelled・cutoff を同一行で判定 — 団体戦のみ cutoff 内の
  グループが弾かれること）/ 二重採用エラー / FK violation の日本語化 / フィルタ条件
  （申込未・採用済み）でも採用が成功すること
- **完了条件:** テスト green・`check-types`・lint 通過

### タスク4: メール詳細 — 候補クエリ・採用シート UI・パースセクション削除 — Issue #437
- [x] 完了（候補の表示名は要件 §3.2.7 どおり**通称ベース**で導出した。手順書の
  「`listMergeCandidateGroups` と同型」は title ベースの記述で要件と食い違うため、
  申込管理ボードと同じ手順1〜3（通称+級 → deriveEntryGroupName → title フォールバック）を採った）
- **目的:** シートに取込単位選択・絞込候補・トグルを実装し、パース取込導線を退役する
- **対応AC:** AC-1（UI）, AC-17（トグル）, AC-18（採用済み表示の級ラベル）, AC-20, AC-21
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/mail/[id]/page.tsx`
  （loadRosterAdoptableEvents → loadRosterAdoptableGroups・「大会名簿の取込」セクション削除・
  採用済み表示に grades）、`components/RosterFileAdoptSheet.tsx`（単位ラジオ・モード別候補・
  級チェックボックス〔同一グループ内のみ複数可〕・トグル）、同 `.test.tsx`
- **依存タスク:** タスク2（純関数）・タスク3（action シグネチャ）
- **必要なテスト:** Sheet のテスト（モード切替で候補が変わる / トグルで全件 / 級別は別グループの
  級を同時選択できない / 送信引数）＋ page から RosterParseButton / roster-drafts リンクが
  消えていること。roster-drafts ページ・パーサの既存テストは**無改修で green**（AC-21）
- **完了条件:** テスト green・`check-types`・lint 通過

### タスク5: 大会詳細の級ラベル表示 — Issue #438
- [x] 完了
- **目的:** RosterSection のファイルカード・補助リンクに級別採用の級ラベルを出す
- **対応AC:** AC-5, AC-6, AC-7, AC-18（大会詳細側）, AC-22
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/page.tsx`（rosterFiles クエリの columns に
  grades を追加・DTO へ転記）、`components/RosterSection.tsx`（ラベル描画）、既存テスト更新
- **依存タスク:** タスク1
- **必要なテスト:** grades ありでラベル表示（「D級」「A・B級」）/ NULL はラベルなし（既存表示
  不変の回帰）/ RSC payload に内部列（sourceMailMessageId 等）が引き続き含まれない
- **完了条件:** テスト green・`check-types`・lint 通過

## 実装順序（Wave = 並行実装できるタスクの組）
- **Wave 1:** タスク1（共有ホットスポット＝スキーマ。単独で先行）
- **Wave 2:** タスク2 / タスク3 / タスク5（互いに依存なし・変更領域が分離: 新規 leaf ファイル /
  actions.ts / events配下）
- **Wave 3:** タスク4（タスク2・3 に依存。mail/[id]/page.tsx と Sheet を1タスクに集約）

## 出荷後の残作業（AC-23）
- 本番で実メールの名簿を新フローで採用し、候補の絞り込み・級ラベル・「すべて表示」トグルを
  実機確認する（対象が無ければ次に名簿が届いたときに確認）。
