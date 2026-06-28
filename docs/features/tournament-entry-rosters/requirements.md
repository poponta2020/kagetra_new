---
status: completed
completed_sections: [ユーザーストーリー, 機能要件, 技術設計, 影響範囲]
next_section: null
---
# 大会ライフサイクル基盤（edition）＋申込・確定名簿 要件定義書

> slug は `tournament-entry-rosters`。当初の「名簿を持つ」要望から、edition を大会ライフサイクルのハブに据える基盤（第1〜2段）＋名簿（第3段）まで拡張した。第4段（出場回数カウント）は本書の対象外（土台のみ用意）。

## 1. 概要

### 目的
大会のライフサイクル（**案内 → 申込 → 確定 → 結果**）を「**開催（edition＝第N回○○大会）**」を中心に1本化し、各大会に **申込者名簿（抽選前）／確定名簿（抽選後）** を紐づけて保持できるようにする。将来の「公認大会 出場回数カウント」の土台。

### 背景・動機
- 現状、同じ現実の大会が `events`（運用・開催前）と `tournaments`（結果・開催後）に**無関係な別レコード**として入り、繋がっていない（[ER 経緯は会話／docs参照]）。
- 既に一括投入済みの `tournament_series`（系列180）/ `tournament_series_editions`（開催1236）が「第N回○○大会」の正準IDになりうる。これをハブにして events と tournaments を束ねる。
- 名簿（申込/確定）はちょうど「案内」と「結果」の隙間を埋め、協会の出場回数算定（**確定名簿掲載＋繰上り出場**ベース、年度4〜3月、対象=公認大会＋新春大会。詳細 `docs/reference/公認大会-抽選-出場回数優先ルール.md`）の素データになる。

## 2. ユーザーストーリー

- **対象**: 管理者／副管理者（運用）、一般会員（閲覧）。
- 管理者として：
  - 案内メールを取り込むと、AIが「第N回○○大会（edition）」を判定（自動サジェスト＋確認）して event に紐づくので、同じ大会の情報が1本化される。
  - 主催者が出す **申込者名簿（締切後・抽選前）** と **確定名簿（抽選後／抽選不要でも発行）** を、メール添付ファイルから取り込んで大会に紐づけて保持できる。
  - 確定名簿から「自会の誰が出場確定したか」を把握できる。
  - （案内を流さない大会も）後日の結果取込時に edition へ紐づけられる。
- 一般会員として：大会詳細で確定名簿・自分の出場確定状況を閲覧できる。
- 将来（第4段）：各会員の年度内（4〜3月）出場回数を数えられる。

## 3. 機能要件

### 3.1 系列/開催（edition）の解決・作成
- **flow①（案内あり）**: 案内ドラフト承認時に、大会名から **系列（tournament_series）を名寄せ**（`name`＋`aliases` で照合）→ **開催（edition）を解決 or 新規作成**（回次は大会名の「第N回」をパース、無ければ「既存最大＋1」を候補提示）→ 生成する events に `edition_id` を設定。
- **flow②（案内なし・結果のみ）**: 結果ドラフト materialize 時に同じ解決を行い `tournaments.edition_id` を設定。
- **名寄せは100%自動にしない**: 曖昧・新規系列・回次不明は **管理者が確認して確定**（既存のドラフト承認フローに確認ステップを挟む）。年→回次の自動関数は不可（同年2回・中止スキップがあるため）。
- 新規 edition 作成は `UNIQUE(series_id, edition_number)` で重複防止＋親行ロックで直列化。
- edition の `status`（held/cancelled/unconfirmed）と `year` を設定。将来開催の扱い（unconfirmed 等）は flow① 実装時に確定。

### 3.2 名簿（rosters）
- 名簿は **2型**：`applicant`（申込者名簿＝締切後・抽選前）／`confirmed`（確定名簿＝抽選後。**抽選不要でも発行**される）。抽選有無は `events.lotteryDate`（null=抽選なし）で表現。
- 取込は **ファイル取込**（メール添付の Excel/PDF を取り込む。手動アップロードも可）。パース→各行を **`players` に解決（姓名のみ同定）**、会員は **`users` に紐付け**。
- 確定名簿の各行に **出場状態**（confirmed/carried_up/carry_up_declined/cancelled）を保持（出場回数の素データ）。繰上り更新は **再取込で confirmed を更新**。
- 1大会につき applicant 0..1／confirmed 0..1。
- **対象は個人戦のみ**（events.kind=individual）。団体戦は対象外（edition_id=null 可）。

### 3.3 表示・突合（判断3＝分離）
- 名簿（事実）取込は **出欠 `event_attendances`（意思）／`events.entryStatus`（会の操作）を自動更新しない**。
- 大会詳細で「申込者名簿／確定名簿」を表示し、**会員の突合**（`roster_entries.user_id` 経由で「自会の誰が載っているか」）を**読み取り表示**で見せる。

### 3.4 ビジネスルール / エラーケース
- 名寄せ誤りは結果を誤った大会に紐づけるため、確認必須・取り消し可能に。
- 同一大会への名簿重複取込は (event_id, roster_type) 一意でガード（再取込は置換/追記方針を実装時決定）。
- パース不能ファイルはエラー提示し DB を汚さない（既存 result-import と同方針）。

## 4. 技術設計（DB中心）

### 4.1 DB設計

**［既存→Drizzle化（判断1=X）］baseline は `prod_schema_series.sql` と差分ゼロで突合、コピーDBで dry-run**
- `tournament_series`: id / `name`(unique) / `aliases` text[] / `kind`(enum tournament_kind: individual|team) / `note` / timestamps
- `tournament_series_editions`: id / `series_id`(FK→tournament_series, cascade) / `edition_number` / `year` / `status`(enum tournament_status: held|cancelled|unconfirmed) / `source_filetype` / `raw_name` / timestamps / UNIQUE(series_id, edition_number)
- enum `tournament_kind`, `tournament_status` も Drizzle 定義に取り込む（既存名そのまま）

**［既存テーブル改修］**
- `events`: **＋`edition_id`**（nullable FK → tournament_series_editions, ON DELETE SET NULL）。**−`event_group_id`**（判断2=B で撤去）。events:edition は **N:1**（複数日/級の events が同一 edition を指す）。
- `tournaments`: **＋`edition_id`** を **Drizzle スキーマに追記**（列は本番に既存。raw ALTER 済みの現物に合わせる）。
- 撤去: `event_groups` テーブル＋関連UI/コード（フォーム・作成・編集・詳細表示・承認画面・seed・truncate）。

**［新規テーブル（第3段）］**
- `tournament_entry_rosters`（名簿ヘッダ）
  - id / `event_id`(FK→events, cascade) / `roster_type`(enum roster_type: applicant|confirmed) / `published_at` date? / `source_attachment_id`(FK→mail_attachments, set null)? / `note` / timestamps
  - UNIQUE(event_id, roster_type)
- `tournament_entry_roster_entries`（名簿の各行＝1人）
  - id / `roster_id`(FK→rosters, cascade) / `player_id`(FK→players, set null) / `user_id`(FK→users, set null) / `grade`(enum grade)? / `raw_name`(not null) / `raw_kana`? / `raw_affiliation`? / `raw_dan`? / `status`(enum roster_entry_status: applied|confirmed|carried_up|carry_up_declined|cancelled) / `seq_no`? / timestamps
  - index(roster_id), index(player_id), index(user_id)

**［新規 enum］** `roster_type`, `roster_entry_status`
**［再利用］** `players`（姓名のみ同定・onConflictDoNothing パターン）／`users`（会員紐付け）

### 4.2 API / Server Actions
- edition 解決コア：`resolveOrCreateEdition({ name, year?, sourceFiletype? }) → { seriesId, editionId, 候補/確認要否 }`（名寄せ＋回次パース）。
- 案内承認（mail-inbox approve）＝flow①、結果 materialize＝flow②、双方からこのコアを呼ぶ。
- 名簿取込：ファイル→パース→roster + entries 生成（人物解決）。
- いずれも管理者操作・トランザクション・冪等（既存 materialize / approve と同方針）。

### 4.3 フロント
- 詳細は design-spec へ（§デザインへの宿題）。要点＝承認時の edition 確認、名簿アップロード/プレビュー、大会詳細の名簿＋会員突合表示。

## 5. 影響範囲
- **撤去**: event_group 一式（`apps/api/src/routes/events.ts`, `apps/web/.../events/new`, `events/[id]/edit`, `events/[id]/page.tsx`, `admin/mail-inbox/actions.ts` の eventGroupId 分岐, `lib/form-schemas.ts`, `components/events/event-form.tsx`, `test-utils/seed.ts`, `test-utils/db.ts`）＋ migration（列・表 drop）。
- **改修**: mail-inbox approve（edition 紐付け）、result materialize（edition 紐付け）。
- **新規**: shared schema（series/editions/rosters/enums）、edition 解決ロジック、名簿取込、名簿/確定 UI。
- **リスク**: series 層 baseline の本番整合（最重要・dry-run 必須）。本番 series/editions は Drizzle 非管理だったため `db:migrate` 運用へ移行。

## 6. 設計判断の根拠
- **判断1=X（series/editions を Drizzle化）**: edition は分析用の置物から「アプリの中核ハブ」に昇格するため、生SQL放置は将来の負債。baseline は1回限りで de-risk 可能。
- **判断2=B（event_group 撤去）**: 「同じ大会の束ね」は edition に一本化。event_group は手動・任意ラベルで役割が重複し、本番は空なので今が撤去の最低コスト。
- **判断3=A（名簿/出欠/申込フラグ分離）**: 出所が「外部事実／会員の意思／会の操作」と異なる3層を自動連動させると意思の上書き・矛盾処理が発生。突合は表示で、出場回数は確定名簿（事実）から数える。
- **判断4=A（基盤先行）**: PR-1 が全前提。実運用前で急ぎでなく、手戻りゼロで edition-aware に積める。
- **edition をハブにする理由**: events:edition は N:1、flow② は event を持たない → 両方を張れるのは edition のみ。出場回数は確定 roster（flow①）と tournament_participants（flow②）の両方から、**edition×年度で重複排除**して数える。
- **名簿2型**: 出場回数は確定名簿掲載＋繰上りのみカウント。applicant/confirmed の型区別が将来の正しい算定の必須条件。

## 実装段取り（PR分割。詳細は implementation-plan.md）
1. **PR-1[土台]**: series/editions Drizzle化(baseline) ＋ events.edition_id 追加 ＋ tournaments.edition_id をスキーマ追記 ＋ event_group 撤去。挙動変更なし。
2. **PR-2[flow①]**: edition 解決コア＋案内承認への組込み＋管理者確認UI。
3. **PR-3[名簿]**: rosters/roster_entries＋ファイル取込（applicant/confirmed・人物解決）。
4. **PR-4[名簿UI]**: 大会詳細の名簿表示＋会員突合。
5. **PR-5[flow②]**: 結果取込への edition 解決組込み。

## デザインへの宿題（→ /design-screen tournament-entry-rosters）
- 案内承認時の **edition 確認UI**（名寄せ候補の提示・回次確認・新規作成の操作）。
- **名簿ファイル取込UI**（アップロード／パース結果プレビュー／人物解決の確認・修正）。
- **大会詳細の名簿表示**（申込者/確定の切替・会員突合のハイライト）。
