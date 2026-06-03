---
status: completed
---
# tournament-title-grade-split 要件定義書

## 1. 概要

### 目的
大会案内メールから AI が抽出するイベントについて、以下 2 点を実現する。

1. **大会名（`events.title`）の短縮命名**: 「`○○大会` の `○○`（場所/地域の固有名）+ 開催級（A→E 順連結）」という競技かるた会の通称ルールで自動命名する。フルネームは正式名称（`events.formal_name`）に保存する。
   - 第11回東大阪競技かるた大会（ABC）→ 大会名 **東大阪ABC** / 正式名称 第11回東大阪競技かるた大会（ABC）
   - 第11回全国競技かるた酒田大会B級 → 大会名 **酒田B** / 正式名称 第11回全国競技かるた酒田大会B級
2. **開催日ごとのイベント分割**: 1 つの案内が級ごとに開催日を分けている場合、開催日ごとに別イベントとして登録する。
   - 大阪大会 B級 1/11・C級 1/12 → **大阪B**(1/11) と **大阪C**(1/12) の 2 イベント
   - 同日に複数級なら 1 イベントに級を連結（東大阪ABC）

### 背景・動機
- これは既存機能 [`mail-tournament-import`](../mail-tournament-import/requirements.md)（ship 済み・本番稼働）の **AI 抽出仕様と承認フローの拡張**である。新規パイプラインの新設ではない。
- 現状の AI は `title` に「第65回全日本かるた選手権大会」のようなフルネームを入れる（[prompt.ts:96-100](../../../apps/mail-worker/src/classify/prompt.ts)）。会の運用では「酒田B」「東大阪ABC」のような短い通称で一覧・LINE 通知を読む文化があり、フルネーム表示は冗長で視認性が悪い。
- 現状は **1 メール = 1 ドラフト = 1 イベント**（[approveDraft](../../../apps/web/src/app/(app)/admin/mail-inbox/actions.ts) は 1 件 INSERT）。級ごとに開催日が違う案内を 1 イベントに丸めると、出欠・支払い・通知が級混在で破綻する。開催日単位に分割して個別管理したい。

### スコープ境界（今回の確定事項）
- 適用経路は **AI メール取り込み → 承認** のみ。手動 `/events/new` 作成は従来どおり（命名補助は付けない）。
- 既存イベント（手動作成・旧データ移行分）は **リネームしない**。新規取り込み分にのみ新命名を適用する。
- 分割・命名の主体は **AI**（抽出時に開催日ごとへ自動分割）。管理者は承認画面で確認・修正する。

---

## 2. ユーザーストーリー

### 対象ユーザー
- **管理者（`admin` / `vice_admin`）** = `/admin/mail-inbox` の運用担当（実質 1 名）。

### ユーザーの目的
- 一覧・LINE 通知で大会を「酒田B」「東大阪ABC」のような通称で即座に識別したい。
- 級ごとに日程の違う大会を、1 操作で複数イベントに分けて登録したい（手作業のコピペ登録をなくす）。
- AI の分割・命名が誤っていれば承認前に直したい。会として出ない級は登録から外したい。

### 利用シナリオ

**シナリオ A: 単一日・単一/複数級（分割なし）**
1. 「第11回東大阪競技かるた大会（ABC）」案内が届く（A・B・C 級すべて同日）。
2. AI が 1 イベント単位として抽出。大会名 = **東大阪ABC**、正式名称 = フルネーム、級 = [A,B,C]。
3. 承認画面に 1 件のイベント案。確認して「登録」→ events 1 件作成。

**シナリオ B: 開催日が級で分かれる（分割あり）**
1. 「大阪大会」案内が届く。B級 1/11、C級 1/12。
2. AI が **開催日ごとに 2 イベント案**へ自動分割。
   - 案①: 大会名 **大阪B** / 1/11 / 級[B] / 定員はB級の値
   - 案②: 大会名 **大阪C** / 1/12 / 級[C] / 定員はC級の値
   - 参加費・申込締切は通常共通なので両案に同値をコピー（案内に級別記載があればそれを反映）。
3. 承認画面に 2 件のイベント案が並ぶ。各案を個別に確認・修正できる。
4. 「選択したイベントを登録」で 2 件まとめて events 作成。

**シナリオ C: 一部だけ登録（保留・見送り）**
1. シナリオ B で、会として C級 には誰も出ないと分かっている。
2. 案②（大阪C）のチェックを外し、案①（大阪B）だけ「登録」→ 大阪B のみ作成。
3. ドラフトは未完了のまま残る（案②は後日登録できる）。後でこの案内を開き直して案②を追加登録、または「残りは作らず完了」でドラフトを閉じられる。

**シナリオ D: AI 分割ミスの修正**
1. AI が 1 件に丸めるべきところを 2 件に割った（または逆）。
2. 管理者が承認画面でイベント案を編集（大会名・日付・級・定員を直接修正）し、不要な案のチェックを外して登録。
3. 想定と大きく違う場合は「再 AI 抽出」で取り直す。

---

## 3. 機能要件

### 3.1 命名ルール（大会名・正式名称）

#### 大会名（`events.title`） = 場所固有名 + 開催級
- **場所固有名（stem）**: `○○大会` の `○○` から、一般語を除いた地域/大会の固有部分。
  - 除去対象の例: `第N回`・`令和N年度`・`全国`・`全日本`・`競技かるた`・`かるた`・`選手権`・`（ABC）` 等の級表記・`のご案内`・`開催のお知らせ`・主催団体名。
  - 残す例: `東大阪`・`酒田`・`大阪`（地域名のない全国大会は `全日本`・`全国大学` のような識別名を stem とする）。
  - stem 抽出は規則化しきれない判断のため **AI が抽出**し、few-shot で例示する。
- **開催級サフィックス**: そのイベント（= その開催日）に含まれる級を **A→E 順で連結**（区切り文字なし）。
  - 例外ルール（確定）: 全級（A〜E）でも機械的に `ABCDE` と連結する。級の記載が無い/不明・無差別級なら **サフィックスを付けず stem のみ**。
- **合成**: `title = stem + grades(A→E順).join('')`。サフィックスの順序はパイプラインで決定論的に整列する（AI の出力順に依存しない）。
- 例:
  | 正式名称（案内） | 級 | 大会名(title) |
  |---|---|---|
  | 第11回東大阪競技かるた大会（ABC） | A,B,C 同日 | 東大阪ABC |
  | 第11回全国競技かるた酒田大会B級 | B | 酒田B |
  | 大阪大会 B級(1/11) | B | 大阪B |
  | 大阪大会 C級(1/12) | C | 大阪C |
  | 全級開催の地方大会 | A〜E 同日 | ○○ABCDE |
  | 級表記なしのオープン戦 | 不明 | ○○ |

#### 正式名称（`events.formal_name`） = 案内の正式な大会名
- 案内に書かれた正式名称をそのまま保存（`第N回`・級表記を含む長い名前）。
- 分割した各イベントには、その級に対応する正式名称を入れる（例: 大阪B → 「第○回…大阪大会B級」、大阪C → 「…C級」）。
- 案内に正式名称の記載が無ければ null 可（その場合 title がそのまま表示名になる）。

### 3.2 分割ルール

- **分割キー = 開催日（`event_date`）**。案内内で開催日が異なる級は別イベントに分割する。
- **同一開催日の複数級は 1 イベント**にまとめ、級をサフィックスに連結する。
- 各イベント（= 各開催日）が持つ値:
  - 固有: `event_date`・`eligible_grades`（その日の級）・`title`・`formal_name`。
  - **級別**: `capacity_a..e` は当該イベントの級の定員のみを入れる（他は null）。定員は級ごとに異なる前提。
  - **共通（通常）**: `fee_jpy`・`entry_deadline`・`payment_deadline`・`payment_info`・`payment_method`・`entry_method`・`organizer`・`location`・`official`・`kind` は案内全体の値を各イベントへコピー。案内に級別記載があれば AI が級別に振り分ける。
- 単一開催日（分割不要）の案内は 1 イベント（現行と同じ。title だけ短縮命名に変わる）。
- 1 メール = 1 ドラフトは維持。**1 ドラフト : N イベント**（ドラフト内にイベント単位配列を持つ）。

### 3.3 画面仕様（`/admin/mail-inbox/[id]` 承認画面）

- 上部の元メール情報・AI 抽出結果表示は現行どおり。
- **イベント案リスト**（`payload.events[]` を 1 件ずつ表示）:
  - 各案に折りたたみ可能な `EventForm`（既存コンポーネント再利用）。`title` は短縮名で pre-fill、`formalName` にフルネーム。
  - 各案の先頭にチェックボックス「このイベントを登録する」（既定 ON）。
  - すでに登録済みの単位（対応 event 作成済み）は「登録済み（events #N）」表示で編集不可・チェック固定。
  - リスト見出し: 「この案内から N 件のイベントを作成します（うち登録済み M 件）」。
- **アクション**:
  - 「選択したイベントを登録」: チェックされた未登録の案を一括 INSERT（1 件のみ選択 = 一部承認）。
  - 「却下」: ドラフト全体を却下（理由必須、現行どおり）。
  - 「残りは作らず完了」: 未登録の案を作成せずドラフトを `approved` で閉じる（シナリオ C 用）。
- **一覧画面（`/admin/mail-inbox` の `DraftCard`）**: 分割イベントの大会名と件数を表示（例: 「大阪B, 大阪C（2件）」）。

### 3.4 ビジネスルール

- AI が級を判別できないイベントは title = stem のみ。承認画面で管理者が級・大会名を修正可能。
- 承認時のイベント INSERT は現行の `events/new` 同等の検証（`eventGroupId` の存在確認、`eligible_grades` の収集）を各案に適用する。
- **部分承認時のドラフト状態**:
  - 一部の案を登録 → 残り未登録の案があればドラフトは `pending_review` のまま、メールも受信箱に残す（未処理）。
  - 全案が登録済み、または「残りは作らず完了」→ ドラフト `approved` + メール `archived` + `triage_status='processed'`（現行の承認連動を踏襲）。
- **再 AI 抽出のガード**: ドラフトに 1 件でも materialize 済みイベント（`events.tournament_draft_id` 参照）がある場合、再抽出を禁止する。再抽出は payload を作り直すため、作成済みイベントと整合が取れなくなるのを防ぐ（現行の「pending_review/ai_failed のみ再抽出可」に加えて追加する条件）。
- **LINE 配信の重複防止**: 承認で複数イベントを作成したとき、[event-line-broadcast](../event-line-broadcast/requirements.md) の自動配信が各イベントで発火するが、**同一 LINE グループへは同じメールを 1 回だけ配信**する（B級・C級が同じ大阪グループに紐付く場合の二重送信を防ぐ）。
- **後方互換**: 既存ドラフトの `extracted_payload` は旧形式（単一 `extracted` オブジェクト）。承認画面・一覧は新旧両形式を読めるよう正規化する（旧形式は 1 単位の配列として扱う）。自動再抽出はしない。

### 3.5 エラーケース・境界条件
- AI が `events: []`（空配列）を返す = 大会案内でないと判断 → noise 扱い（現行どおりドラフト未作成、`classification='noise'`）。
- 開催日が抽出できない案内（期間表記のみ等）→ その単位の `event_date` は null。`events.event_date` は NOT NULL なので、管理者が承認前に日付を補完しないと登録不可（フォームバリデーションで弾く、現行どおり）。
- 級が 6 つ以上・A〜E 以外の表記 → A〜E にマップできない級は無視（サフィックスに含めない）。
- 同一案内で同一開催日・同一級が重複抽出 → パイプラインで unit を重複排除（`unit_key` 一意化）。

---

## 4. 技術設計

### 4.1 AI 抽出スキーマ（`apps/mail-worker/src/classify/schema.ts`）

`ExtractionPayloadSchema` をイベント配列形に変更（**破壊的変更 → PROMPT_VERSION を 2.0.0 に major bump**）。

```typescript
const GradeSchema = z.enum(['A', 'B', 'C', 'D', 'E'])

// 1 開催日 = 1 イベント単位
const EventUnitSchema = z.object({
  unit_key: z.string(),               // 安定 ID（"u1","u2"… / 開催日+級から生成）。再描画・部分承認の突合に使う
  event_date: IsoDateSchema,          // その単位の開催日（分割キー）
  eligible_grades: z.array(GradeSchema).nullable(), // その日の級
  formal_name: z.string().nullable(), // その級に対応する正式名称
  venue: z.string().nullable(),
  fee_jpy: z.number().int().nullable(),
  payment_deadline: IsoDateSchema,
  payment_info_text: z.string().nullable(),
  payment_method: z.string().nullable(),
  entry_method: z.string().nullable(),
  organizer_text: z.string().nullable(),
  entry_deadline: IsoDateSchema,
  kind: z.enum(['individual', 'team']).nullable(),
  capacity_a: z.number().int().nullable(),
  capacity_b: z.number().int().nullable(),
  capacity_c: z.number().int().nullable(),
  capacity_d: z.number().int().nullable(),
  capacity_e: z.number().int().nullable(),
  official: z.boolean().nullable(),
})

export const ExtractionPayloadSchema = z.object({
  is_tournament_announcement: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  is_correction: z.boolean().optional(),
  references_subject: z.string().nullable().optional(),
  short_name_stem: z.string().nullable(),   // 「○○」場所固有名（案内全体で共通）
  events: z.array(EventUnitSchema),         // 大会案内なら 1 件以上、noise なら []
  extras: z.object({ /* 既存どおり、案内全体の備考 */ }).optional(),
})
```

- **title の合成**: パイプライン側で `title = short_name_stem + sortedGrades(unit.eligible_grades)`。grades が null/空なら stem のみ。これにより級サフィックスの順序を決定論化する。合成結果は承認フォームの初期値として使い、管理者が上書き可能。
- noise 判定は `is_tournament_announcement=false` かつ `events: []`（現行の noise 分岐をそのまま使う）。

### 4.2 プロンプト（`apps/mail-worker/src/classify/prompt.ts`）

- `PROMPT_VERSION = '2.0.0'`。
- フィールド別ガイダンスを刷新:
  - `short_name_stem`: 「○○大会」の○○から一般語（第N回/全国/全日本/競技かるた/選手権 等）を除いた固有名。
  - `events[]`: 開催日ごとに 1 単位。同日複数級は 1 単位にまとめる。級ごとに開催日が違えば単位を分ける。
  - 各単位の `formal_name` はその級の正式名称、`capacity_*` は当該級のみ、費用・締切は級共通なら同値を各単位へ。
- few-shot を入れ替え（cache 2048 token 維持を確認）:
  - 例1: 単一日・複数級（東大阪ABC、1 単位、grades[A,B,C]）
  - 例2: 開催日分割（大阪 B級1/11・C級1/12 → 2 単位、stem「大阪」）
  - 例3: ノイズ（events:[]）
  - 例4: 訂正版（is_correction=true）

### 4.3 DB 設計（`packages/shared/src/schema/`）

新規 migration（連番は実装時に確認し衝突回避）。追加はすべて nullable で**非破壊**。

**`events` に 2 カラム追加**:
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| tournament_draft_id | integer | nullable, FK → tournament_drafts.id, ON DELETE SET NULL | この AI 由来イベントの元ドラフト。1ドラフト:Nイベントの実体リンク |
| tournament_draft_unit_key | text | nullable | 元ドラフト payload 内の `unit_key`。承認済み単位の突合に使う |

- `tournament_drafts.event_id`（既存・単一 FK）は **訂正版の既存大会紐付け（`linkDraftToEvent`）専用**として残す。分割承認では null のまま、`events.tournament_draft_id` を正とする。意味の二重性をスキーマコメントに明記。
- `tournament_drafts.extracted_payload`（jsonb）は列型変更なし。中身の形だけ 4.1 に変わる（コードで吸収）。
- 新規 enum なし。

### 4.4 バックエンド（Server Actions: `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`）

- **`approveDraftUnits(draftId, units)`**（`approveDraft` を置換/拡張）:
  - 入力: チェックされた各単位の event フォーム値（`unit_key` 付き）。
  - 処理（1 トランザクション）: 各単位を `eventFormSchema` で検証 → `events` を INSERT（`tournamentDraftId`・`tournamentDraftUnitKey`・`createdBy` 付き）。
  - 全単位が materialize 済みになったらドラフト `approved` + メール `archived`/`processed`。残あればドラフト `pending_review` 維持・メールは受信箱に残す。
  - 認可: admin / vice_admin。
- **`completeDraft(draftId)`**: 残り単位を作らずドラフトを `approved` + メール `archived`/`processed`。
- **`rejectDraft` / `linkDraftToEvent` / `reextractDraft`**: 維持。`reextractDraft` に「materialize 済みイベントがあれば拒否」ガードを追加。
- **LINE 配信**: 承認後、作成イベントのうち LINE グループ紐付け済みのものについて `broadcastMailToEvent` を発火。ただし **同一グループへは 1 回のみ**（作成イベントの紐付けグループで重複排除してから配信）。`after()` で応答後に実行する現行方式を踏襲。

### 4.5 フロントエンド（`apps/web/src/app/(app)/admin/mail-inbox/`）

- **`ApprovalForm.tsx`**: `payload.events[]` をループし、単位ごとに `EventForm` + 登録チェックボックスを描画。旧形式 payload は `extracted` を 1 単位へ正規化。複数単位のフォーム値を 1 submit で送れるよう、フィールドを単位ごとに名前空間化（例 `units[i].title`）し、Server Action 側で `unit_key` ごとにパースする。
- **`extractEventFormData` / `eventFormSchema`（`form-schemas.ts`）**: 単位ごとのパースに対応（配列入力のヘルパー追加、既存単一フォーム経路は不変）。
- **`DraftCard.tsx`**: 分割時の大会名一覧・件数表示。
- **`[id]/page.tsx`**: payload 正規化と新フォーム呼び出し、`completeDraft` ボタン配線、登録済み単位の表示。
- ナビ・権限ガードは現行のまま。

### 4.6 処理フロー
```
メール取得(現行) → AI 抽出(2.0.0: short_name_stem + events[]) → tournament_drafts 1件 UPSERT
  → 承認画面で events[] を N フォーム表示
  → approveDraftUnits: 選択単位を events に INSERT (tournament_draft_id 付与, title 合成)
  → 全単位完了 or completeDraft で draft=approved + mail processed
  → LINE 配信(グループ重複排除)
```

---

## 5. 影響範囲

### 5.1 変更が必要な既存ファイル
- `packages/shared/src/schema/events.ts`: `tournamentDraftId`・`tournamentDraftUnitKey` 追加。
- `packages/shared/src/schema/relations.ts`: events ↔ tournament_drafts の relation 追加。
- `packages/shared/`: 新規 migration（events 2 カラム + FK）。
- `apps/mail-worker/src/classify/schema.ts`: `ExtractionPayloadSchema` を配列形へ。
- `apps/mail-worker/src/classify/prompt.ts`: PROMPT_VERSION 2.0.0、ガイダンス・few-shot 刷新。
- `apps/mail-worker/src/classify/classifier.ts`（`persistOutcome`）: 新 payload を保存（top-level の confidence/is_correction 参照は維持、`extracted`→`events` 参照に追従）。**title 合成ロジックの配置**（pipeline かフォーム初期化のいずれか）を決めて実装。
- `apps/web/.../mail-inbox/actions.ts`: `approveDraftUnits`・`completeDraft` 追加、`reextractDraft` ガード追加、broadcast 重複排除。
- `apps/web/.../mail-inbox/components/ApprovalForm.tsx`・`DraftCard.tsx`・`[id]/page.tsx`: 複数イベント UI。
- `apps/web/src/lib/form-schemas.ts`: 単位配列パース対応。
- 各 `*.test.ts(x)`: スキーマ・承認・フォームのテスト更新/追加。

### 5.2 既存機能への影響
- **既存イベント**: スキーマ追加は nullable のため無影響。title はリネームしない。
- **手動 `/events/new`・`/events/[id]/edit`**: `EventForm` は据え置き（単位配列化は承認画面側のラッパで吸収）。
- **mail-triage-badge**: 承認/却下/完了時の `triage_status='processed'` 連動は踏襲。部分承認中は未処理のまま残る（バッジに残る）= 仕様どおり。
- **event-line-broadcast**: 1 メール→N イベントで配信が増えうるため、グループ重複排除を必須要件として追加。
- **旧ドラフト**: 新形式へ自動移行しない。旧 pending は再抽出 or 旧形式正規化表示で承認可能。
- **CI/E2E**: `/admin/mail-inbox` の複数イベント承認ハッピーパスを E2E に追加。mail-worker のスキーマ/プロンプトの fixture テスト更新。

---

## 6. 設計判断の根拠

- **なぜ AI が分割するか**: 「開催日ごとに別イベント」は案内本文の読解（どの級がどの日か）が必要で、管理者の手作業コピペは負荷が高い。AI 自動分割 + 承認時修正が運用負荷最小（ユーザー選択）。
- **なぜ 1 ドラフト : N イベント（ドラフトは 1 メール 1 件維持）か**: `tournament_drafts.message_id` UNIQUE と既存の UPSERT/再抽出/triage 連動を壊さずに済む。分割はあくまで「1 案内の中の複数イベント」なので、抽出単位（ドラフト）は 1 件が自然。
- **なぜ `events.tournament_draft_id` を新設するか**: 単一 FK `tournament_drafts.event_id` では N イベントを表現できない。イベント側に元ドラフトを持たせると、部分承認の突合・監査・配信重複排除が素直に書ける。`event_id` は訂正版の既存大会紐付け専用として温存。
- **なぜ stem を AI、級サフィックスをパイプライン合成にするか**: 「○○」抽出は判断が要る（AI 向き）。級連結は A→E 固定の機械処理（決定論化したい）。責務を分けると順序ブレを防ぎつつ title を再合成・編集できる。
- **なぜ title=短縮 / formal=フル（新カラムを足さない）か**: 大会名（通称）は一覧・LINE 通知の主表示。会の文化に合わせ title を通称にし、フルネームは既存 `formal_name` に保存すれば新カラム不要で改修最小（ユーザー選択）。
- **なぜ参加費・締切は共通コピー・定員のみ級別か**: 実運用で費用・締切は級共通が大半、定員は級別が普通（ユーザー知見）。例外は AI が級別記載を拾い、最終的に管理者が承認時に直す。
- **なぜ部分承認 + 完了ボタンか**: 会として出ない級を登録から外す運用がある。per-unit の reject カラムを足さずとも、「作成済みイベントの有無」で未処理単位を導出し、明示的「完了」でドラフトを閉じられる（スキーマ最小）。

---

## 7. 範囲外
- 手動 `/events/new` の命名補助（正式名称→大会名の自動生成ボタン）。
- 既存イベントの一括短縮リネーム。
- AI による confidence 自動承認。
- 「同日だが会場/セッションが別」での分割（分割キーは開催日のみ）。
- 1 案内に複数の別大会が混在するケースの自動分離（稀。管理者が手動対応）。

---

## 8. 開発・テスト戦略
- **mail-worker**: `ExtractionPayloadSchema` の Zod テスト、分割/単一/noise/訂正の fixture と期待 JSON 更新、title 合成のユニットテスト（A→E 順、stem のみ、空級）。
- **web**: `approveDraftUnits`（一括/一部/全完了で draft 状態遷移）、`completeDraft`、`reextractDraft` ガード、broadcast グループ重複排除のユニットテスト。`ApprovalForm` の複数単位描画・旧形式正規化のテスト。
- **E2E**: 分割案内ドラフトを seed → 承認画面で 2 件 → 一部登録 → 残り完了、までのハッピーパス。
- **移行確認**: 旧形式 payload の pending ドラフトが承認画面で壊れず表示・承認できること。
