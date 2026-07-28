---
status: completed
---
# roster-file-adoption 実装手順書

要件: `docs/features/roster-file-adoption/requirements.md`（AC は §4）
親Issue: #403

## 技術設計の要点

### データモデル: 新テーブル `tournament_entry_roster_files`

`tournament_entry_rosters` を拡張せず**独立したテーブル**にする。理由:

- `tournament_entry_rosters` に「entries を持たない行」を混ぜると、その表を読む既存の消費者が全部壊れる。
  特に `/dashboard`（home-tournament-timeline）は confirmed 名簿の entries から出場者チップを描き、
  名簿が無いときだけ出欠へフォールバックする。entries 0 件の roster 行が挿さると
  **フォールバックが効かなくなり「出場者0人」と表示される**。RosterSection の件数表示・
  抽選事実（lottery facts）・版管理（UNIQUE(entry_group_id, roster_type, version)）も同様に巻き込む。
- ファイル採用は「構造化データ」ではなく「原本のポインタ」であり、版管理も統計寄与も持たない。
  別テーブルにすることで、既存の名簿パイプラインへの影響を**構造的にゼロ**にできる。

```
tournament_entry_roster_files
  id                     integer PK (generated always as identity)
  entry_group_id         integer NOT NULL → entry_groups(id) ON DELETE RESTRICT
  roster_type            roster_type NOT NULL              -- 既存 enum を再利用
  source_attachment_id   integer NOT NULL → mail_attachments(id) ON DELETE CASCADE
  source_mail_message_id integer          → mail_messages(id)   ON DELETE SET NULL
  published_at           date
  note                   text
  adopted_at             timestamptz NOT NULL DEFAULT now()
  adopted_by_user_id     text             → users(id)           ON DELETE SET NULL
  created_at / updated_at timestamptz NOT NULL DEFAULT now()

  UNIQUE (source_attachment_id)                     -- 同一添付の二重採用を禁止（AC-11）
  INDEX  (entry_group_id, roster_type)              -- ボード判定・大会詳細の引き
```

**FK の onDelete 決定（要件 §6 の未解決論点）**:
- `source_attachment_id` = **CASCADE**。`mail_attachments.mail_message_id` は
  `mail_messages` から CASCADE なので、ここを RESTRICT にすると将来メール削除機能を作ったときに
  削除が FK 違反で落ちる。同じ「添付へのポインタ」である `attachment_share_tokens` /
  `event_broadcast_guideline_attachments` も CASCADE で、その前例に揃える。
  ファイルが消えた採用レコードは意味を持たない（＝残す価値がない）ので、道連れが正しい。
  現時点でメール削除・添付削除の経路はコード上に存在しない（grep 済み）ため、実挙動への影響は無い。
- `entry_group_id` = **RESTRICT**。`tournament_entry_rosters` と同じ（グループ削除で名簿が消えない）。

### `hasConfirmedRoster` の拡張点は 1 箇所だけ

`classify`（`entry-board-utils.ts`）は `hasConfirmedRoster: boolean` を受け取るだけなので**純関数側は変更不要**。
拡張するのは `/admin/entries/page.tsx` の `groupIdsWithConfirmedRoster` を作るクエリのみ（パース済み ∪ ファイル採用）。

`classify` の他の消費者は無い（grep 済み: `groupBoard` からのみ）。entry-overdue-alert は
`events.entry_status='not_applied'` しか見ておらず名簿に依存しないため、**ボードとリマインドが
食い違う余地はない**（PR #377 で踏んだ二重定義の罠は今回発生しない）。

### 会員向けビューアの route 構成

管理者向け（`/admin/mail-inbox/attachments/[id]` + `/api/admin/mail/attachments/[id]{,/preview/[page]}`）は
**一切変更しない**。会員向けに以下を新設し、認可を「採用済みかどうか」だけで判定する（fail-closed）:

| パス | 内容 |
|---|---|
| `/roster-files/[id]`（ページ） | ログイン必須。採用済みファイルのビューア。既存 `attachment-preview` でページ画像化して inline 表示。ダウンロード導線を併置 |
| `/api/roster-files/[id]`（バイナリ） | 既存 admin route と同じ MIME allowlist / disposition 規約をそのまま適用（iOS PWA 白画面死対策） |
| `/api/roster-files/[id]/preview/[page]`（JPEG） | 既存 admin preview route と同型。出力は pdftoppm 生成 JPEG なので常に inert |

- 認可ヘルパー `loadAdoptedRosterFile(id)` を 1 本用意し、3 経路すべてがこれを通す
  （採用レコードが無ければ null → 404）。解除した瞬間に 3 経路とも 404 になる。
- `detectPreviewKind` が `'none'` を返す型（libreoffice が変換できない zip 等）は
  **ページ画像を出さずダウンロードのみのカード**にする。AC-8 の「閲覧できる」はこの場合
  「ビューアページが 200 でダウンロード導線が出る」ことを指す。

### 採用 UI（メール詳細）

- 添付一覧は**拡張子で絞らない**。`isRosterSourceFilename`（パーサの入力フィルタ）は流用しない —
  パースしない機能なので、掲示写真(.jpg)や .zip を弾く理由がない。
- 既存の `ExistingEventLinkSheet` と同じボトムシート様式で、対象イベント（`loadLinkableEvents` の
  候補条件＝`linkable-events.ts` を共有）・種別（申込/確定）・発表日（既定=メール受信日）を選ぶ。
- Server Action は `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` に追加（既存の
  `requireAdminSession` + `revalidatePath` 規約に従う）。イベント → `entry_group_id` の解決は
  サーバー側で行い、`validateLinkableEvent` で候補条件を再検証する（UI 表示後の状態変化・直接叩き対策）。

---

## 実装タスク

### タスク1: スキーマ＋マイグレーション（共有ホットスポット）
- [ ] 完了
- **目的:** `tournament_entry_roster_files` を追加し、relations / schema index / migration を整える
- **対応Issue:** #404
- **対応AC:** AC-11（UNIQUE 制約）、AC-12
- **主な変更領域:** `packages/shared/src/schema/tournament-entry-roster-files.ts`（新規）、
  `packages/shared/src/schema/index.ts`、`packages/shared/src/schema/relations.ts`、
  `packages/shared/drizzle/0051_*.sql`（`pnpm --filter @kagetra/shared db:generate` で生成）
- **依存タスク:** なし
- **必要なテスト:** `packages/shared/__tests__/` に `tournament-lottery-schema.test.ts` と同型の
  スキーマテスト（列・UNIQUE・FK onDelete が定義どおりか）
- **完了条件:** テスト green・`check-types` 通過・生成 migration が journal 経路で空 DB に適用できる

### タスク2: 採用/解除 Server Action ＋ メール詳細の採用 UI
- [ ] 完了
- **目的:** 管理者が添付を対象イベント＋種別を指定して名簿ファイルとして採用・解除できるようにする
- **対応Issue:** #405
- **対応AC:** AC-1, AC-2, AC-10, AC-11
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（`adoptRosterFile` /
  `releaseRosterFile` を追加）、`apps/web/src/app/(app)/admin/mail-inbox/mail/[id]/page.tsx`（採用状態の取得と
  セクション追加）、`apps/web/src/app/(app)/admin/mail-inbox/components/RosterFileAdoptSheet.tsx`（新規）
- **依存タスク:** タスク1
- **必要なテスト:** actions のテスト（admin/vice_admin 以外は拒否 / 採用レコード作成 / 同一添付の
  二重採用はエラー / 同一グループ×種別へ複数採用は可 / 解除で消える / `validateLinkableEvent` 違反は拒否）
- **完了条件:** テスト green・`check-types`・lint 通過

### タスク3: 会員向け名簿ファイルビューア（ページ＋2 route）
- [ ] 完了
- **目的:** 採用済みファイルだけをログイン会員が閲覧・ダウンロードできる経路を作る
- **対応Issue:** #406
- **対応AC:** AC-8, AC-9
- **主な変更領域:** `apps/web/src/lib/roster-file-access.ts`（新規・`loadAdoptedRosterFile`）、
  `apps/web/src/app/(app)/roster-files/[id]/page.tsx`（新規）、
  `apps/web/src/app/api/roster-files/[id]/route.ts`（新規）、
  `apps/web/src/app/api/roster-files/[id]/preview/[page]/route.ts`（新規）
- **依存タスク:** タスク1
- **必要なテスト:** route テスト（未ログイン 401 / 採用済み 200 / 未採用・解除済み 404 /
  id の正準整数チェック）＋ MIME allowlist と disposition が admin route と同じ判定になること
- **完了条件:** テスト green・`check-types`・lint 通過。既存 admin route に差分が無い

### タスク4: 大会詳細のファイル名簿表示
- [ ] 完了
- **目的:** パース済み名簿が無い種別ではファイル名簿カードを、ある種別では補助リンクを出す
- **対応Issue:** #407
- **対応AC:** AC-5, AC-6, AC-7
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/page.tsx`（entry_group から採用ファイルを
  取得。**列を明示指定して内部列を RSC payload へ出さない**）、
  `apps/web/src/app/(app)/events/[id]/components/RosterSection.tsx`
- **依存タスク:** タスク1
- **必要なテスト:** RosterSection のテスト（パース済み無し＋ファイル有り→カード表示 /
  パース済み有り→構造化が主・ファイルは補助リンク / どちらも無し→現行の未取込文言）＋
  page のクエリテスト（グループ内の別日からも同じファイルが見える）
- **完了条件:** テスト green・`check-types`・lint 通過。RSC payload に `sourceMailMessageId` /
  `adoptedByUserId` / `note` が含まれないことをテストで固定

### タスク5: 申込管理ボードの hasConfirmedRoster 拡張
- [ ] 完了
- **目的:** confirmed のファイル採用がある大会をフェーズ進行させる
- **対応Issue:** #408
- **対応AC:** AC-3, AC-4
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/page.tsx`（`groupIdsWithConfirmedRoster` の
  クエリのみ）。`entry-board-utils.ts` は**変更しない**（純関数の契約は不変）
- **依存タスク:** タスク1
- **必要なテスト:** page のクエリテスト（confirmed ファイル採用のみのグループが true /
  applicant ファイル採用だけでは false / パース済みとファイルの OR）＋
  既存の entry-board テスト群が無改修で green（判定条件を変えていないことの回帰）
- **完了条件:** テスト green・`check-types`・lint 通過

## 実装順序（Wave = 並行実装できるタスクの組）
- **Wave 1:** タスク1（共有ホットスポット＝スキーマ。単独で先行）
- **Wave 2:** タスク2 / タスク3 / タスク4 / タスク5（互いに依存なし・変更領域が完全に分離。
  タスク4 → タスク3 のビューア URL は `/roster-files/{id}` で契約固定するため独立実装できる）

## 出荷後の残作業（AC-13 / ship 時に必ず消化する）
1. 本番のメール詳細から滞留中の 3 添付を採用する:
   - 添付 316（`E級・D級クラス分け.xlsx`, mail 251）→ 対象大会に **確定名簿** として採用
   - 添付 318/319（秋田大会 参加者一覧・参加費一覧, mail 253/254）→ 秋田DE（event 21）に **確定名簿** として採用
2. `/admin/entries` で該当大会が「名簿確定・要振込」へ移ったことと、`/events/[id]` に原本ファイルが
   出ることを実機確認する。
3. **★制約: 出荷まで名簿ドラフト #1〜#3 を却下しないこと。** 却下すると同じ添付を再解析できなくなる
   （このバグの修正は本機能の Non-goals＝別 quickfix）。ファイル採用はドラフトの状態と独立なので、
   pending_review のまま採用して問題ない。
