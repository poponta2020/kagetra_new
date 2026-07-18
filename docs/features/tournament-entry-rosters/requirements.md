---
status: completed
design_required: false
completed_sections: [変更の動機と内容, 変更後の挙動, 変わらないもの, 互換性・データ, Acceptance Criteria と Non-goals, 技術的制約・契約]
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

### 2026-07-18 改修の動機と変更差分

- **Before:** メールで取り込んだ大会の承認画面では、AI抽出名から作った系列名候補が既存系列の正準名または別名に正規化完全一致した場合だけ既存系列として自動選択される。部分一致候補は内部で算出できるが画面に表示されず、管理者は自由入力欄へ正確な系列名を手入力しなければならない。
- **After:** 管理者は承認画面で既存系列を正準名・別名から部分一致検索し、候補一覧から明示選択できる。選択した系列と確認済みの回次を使って開催へ紐づける。
- **維持する安全策:** 曖昧候補や新規系列は自動確定しない。検索欄へ文字を入力しただけでは既存系列の選択にも新規系列の作成にもならない。

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
- **flow①（案内あり）**: 案内ドラフト承認時に、大会名から **系列（tournament_series）を名寄せ**（`name`＋`aliases` で照合）→ **開催（edition）を解決 or 新規作成**（回次は大会名の「第N回」をパース）→ 生成する events に `edition_id` を設定。
  - 正規化完全一致が1件だけなら、その既存系列を初期選択し、回次を確認できる状態にする。
  - 完全一致しない、または複数の完全一致がある場合は、AI抽出から作った系列名候補を検索語の初期値として表示するが、系列は未選択のままにする。
  - 管理者は既存系列を **正準名または別名の部分一致**で絞り込み、候補から1件を選択できる。全角・半角、空白、一般的な区切り・装飾の差は検索時に吸収する。
  - 検索結果には正準名を主表示し、別名に一致した場合はどの別名が一致したか判別できる情報を添える。
  - 既存系列を選択した後は、その系列の正準レコードを紐づけ対象とする。検索欄の文字列を再度名寄せして別系列へ解決し直さない。
  - 回次はAI抽出値を初期値とし、管理者が正の整数へ修正できる。回次不明のままでは開催へ紐づけられない。
  - 一致する系列がない場合だけ、検索語をもとに新規系列を作る経路を提示する。新規作成は既存どおり明示確認を必須とする。
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
- 既存系列の検索候補は、承認対象イベントと個人戦／団体戦の種別が一致する系列だけを選択可能にする。不整合な要求は画面外から送信されてもサーバーで拒否する。
- 開催への紐づけを選ばない場合は、従来どおり `edition_id = null` のイベントとして承認できる。
- 1通の案内から複数イベントを作る場合、および部分承認を複数回に分ける場合も、同じ案内から作られた全イベントは管理者が選んだ同一開催へ収束する。
- 同一大会への名簿重複取込は (event_id, roster_type) 一意でガード（再取込は置換/追記方針を実装時決定）。
- パース不能ファイルはエラー提示し DB を汚さない（既存 result-import と同方針）。

## 4. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-1 | AI抽出名が既存系列の正準名または別名に正規化完全一致し、該当系列が1件だけの場合、その正準系列が初期選択され、抽出できた回次とともに開催紐づけが有効になる | auto-test |
| AC-2 | 完全一致がない、または完全一致が複数ある場合、AI由来の系列名候補は検索語へ入るが、既存系列は未選択であり、管理者が選ぶまで開催紐づけは確定しない | auto-test |
| AC-3 | 管理者が正準名または別名の一部を入力すると、全角・半角、空白、一般的な区切り・装飾の差を吸収して既存系列が絞り込まれ、正準名と一致した別名を判別できる | auto-test |
| AC-4 | 管理者が検索結果から既存系列を1件選び、正の整数の回次を指定して承認すると、その系列と回次の開催が解決または作成され、対象イベントに紐づく | auto-test |
| AC-5 | 検索欄に文字を入力しただけ、回次が空または不正、種別不一致の系列、存在しない／改ざんされた系列指定では承認処理が開催を誤作成・誤紐づけせず、操作可能な日本語エラーを返す | auto-test |
| AC-6 | 一致する既存系列がない場合、新規系列作成を管理者が明示確認したときだけ新規系列と開催を作成できる。明示確認なしでは作成しない | auto-test |
| AC-7 | 開催紐づけを選ばずに承認した場合、イベントは従来どおり作成され、`edition_id` は null のままになる | auto-test |
| AC-8 | 1案内から複数イベントを同時または部分承認で作成した場合、既に作成済みのイベントを含め、同じ案内由来の全イベントが選択した同一開催へ収束する | auto-test |
| AC-9 | 結果取込側の保守的な自動名寄せ、開催の一意制約、並行承認の直列化、管理者／副管理者のみが承認できる既存挙動が維持される | auto-test |
| AC-10 | 375px幅の承認画面で、検索開始・候補比較・選択解除・該当なし・新規作成確認・回次修正を、候補や承認ボタンを見失わず完了できる | verify |
| AC-11 | 対象テスト、lint、typecheck がすべて成功する | auto-test |

## 5. Non-goals

- 誤字を推測する編集距離ベースの曖昧検索や、AIによる系列候補の再推論。
- 系列マスタの名称変更、別名追加・削除、統合・分割を行う管理画面。
- 既存の `edition_id = null` データの一括バックフィル。
- 結果ドラフト承認画面（flow②）の系列選択UX変更。
- 回次の年からの自動推定、既存最大回次からの自動採番。
- 系列／開催テーブルのスキーマ変更。

## 6. 技術設計（DB中心）

### 6.1 DB設計

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

### 6.2 API / Server Actions
- edition 解決コア：`resolveOrCreateEdition({ name, year?, sourceFiletype? }) → { seriesId, editionId, 候補/確認要否 }`（名寄せ＋回次パース）。
- 案内承認（mail-inbox approve）＝flow①、結果 materialize＝flow②、双方からこのコアを呼ぶ。
- 案内承認画面は全系列を1回の読み取りで取得し、AI抽出名から作る初期候補と検索選択肢を同じスナップショットから組み立てる。180件規模のため検索専用APIは追加せず、画面内で絞り込む。
- 既存系列を選ぶ経路は系列IDを送信し、承認トランザクション内で存在・個人戦／団体戦種別を再検証してから edition を解決する。系列名による再名寄せは、新規系列を明示作成する経路にだけ残す。
- 名簿取込：ファイル→パース→roster + entries 生成（人物解決）。
- いずれも管理者操作・トランザクション・冪等（既存 materialize / approve と同方針）。

### 6.3 フロント
- 承認時の edition 確認は、既存の検索ボトムシートパターンを踏襲する。検索語、選択済み系列、新規作成候補を別状態として持ち、hidden field には選択済み系列IDまたは明示確認済みの新規系列名だけを反映する。
- 名簿アップロード/プレビュー、大会詳細の名簿＋会員突合表示は現行を維持する。

## 7. 技術的制約・契約

- 既存の `tournament_series`、`tournament_series_editions`、`events.edition_id` とそのデータをそのまま利用し、移行は行わない。
- 既存系列の選択結果は正準レコードを直接指す契約とし、表示文字列の再名寄せに依存しない。
- 検索・選択UIを変更しても、サーバー側の権限、種別整合、回次、曖昧一致、新規作成明示、トランザクション、冪等性の検証を省略しない。
- 系列180件規模、別名を持つ系列27件（ローカル統合DBの2026-07-18実測）を、追加の本番データ移行なしで扱えること。
- UIの見た目・モバイル上の操作構造は `design-spec.md` を正とし、本書では検索・選択・確定のロジックだけを定義する。

## 8. 影響範囲
- **撤去**: event_group 一式（`apps/api/src/routes/events.ts`, `apps/web/.../events/new`, `events/[id]/edit`, `events/[id]/page.tsx`, `admin/mail-inbox/actions.ts` の eventGroupId 分岐, `lib/form-schemas.ts`, `components/events/event-form.tsx`, `test-utils/seed.ts`, `test-utils/db.ts`）＋ migration（列・表 drop）。
- **改修**: mail-inbox approve（edition 紐付け）、result materialize（edition 紐付け）。
- **新規**: shared schema（series/editions/rosters/enums）、edition 解決ロジック、名簿取込、名簿/確定 UI。
- **リスク**: series 層 baseline の本番整合（最重要・dry-run 必須）。本番 series/editions は Drizzle 非管理だったため `db:migrate` 運用へ移行。

## 9. 設計判断の根拠
- **判断1=X（series/editions を Drizzle化）**: edition は分析用の置物から「アプリの中核ハブ」に昇格するため、生SQL放置は将来の負債。baseline は1回限りで de-risk 可能。
- **判断2=B（event_group 撤去）**: 「同じ大会の束ね」は edition に一本化。event_group は手動・任意ラベルで役割が重複し、本番は空なので今が撤去の最低コスト。
- **判断3=A（名簿/出欠/申込フラグ分離）**: 出所が「外部事実／会員の意思／会の操作」と異なる3層を自動連動させると意思の上書き・矛盾処理が発生。突合は表示で、出場回数は確定名簿（事実）から数える。
- **判断4=A（基盤先行）**: PR-1 が全前提。実運用前で急ぎでなく、手戻りゼロで edition-aware に積める。
- **edition をハブにする理由**: events:edition は N:1、flow② は event を持たない → 両方を張れるのは edition のみ。出場回数は確定 roster（flow①）と tournament_participants（flow②）の両方から、**edition×年度で重複排除**して数える。
- **名簿2型**: 出場回数は確定名簿掲載＋繰上りのみカウント。applicant/confirmed の型区別が将来の正しい算定の必須条件。
- **系列検索は正準名＋別名を対象にする**: 180系列のうち27系列が別名を持ち、「シニア選手権大会」→「シニア選手権」のようにメール表記と正準名が異なる。正準名だけの検索では既存データを活かせない。
- **検索語と選択を分離する**: 自由入力を選択扱いにすると誤抽出名のまま新規マスタ化する既存リスクが復活する。検索語は候補探索、選択済み系列は紐づけ先という別状態にする。
- **部分一致までで止める**: 全角・空白・装飾差の吸収と部分一致で180件規模の運用には十分であり、誤字推測は誤紐づけリスクと実装複雑性が高いため対象外とする。
- **design-screen は省略**: 2026-07-19の要件承認時にユーザーが明示指定。新しい画面体系は作らず、既存の承認フォームと検索ボトムシートのUIパターンを踏襲する。

## 実装段取り（PR分割。詳細は implementation-plan.md）
1. **PR-1[土台]**: series/editions Drizzle化(baseline) ＋ events.edition_id 追加 ＋ tournaments.edition_id をスキーマ追記 ＋ event_group 撤去。挙動変更なし。
2. **PR-2[flow①]**: edition 解決コア＋案内承認への組込み＋管理者確認UI。
3. **PR-3[名簿]**: rosters/roster_entries＋ファイル取込（applicant/confirmed・人物解決）。
4. **PR-4[名簿UI]**: 大会詳細の名簿表示＋会員突合。
5. **PR-5[flow②]**: 結果取込への edition 解決組込み。

## デザインへの宿題（→ /design-screen tournament-entry-rosters）
- 案内承認時の **edition 確認UIのdelta**: 375px幅で、AI候補、検索入力、正準名＋一致別名の候補一覧、選択済み状態、選択解除、該当なし、新規系列作成、回次確認をどう配置するか。既存の自由入力＋チェックボックスから、検索と明示選択が迷わない構造へ変更する。
- **名簿ファイル取込UI**（アップロード／パース結果プレビュー／人物解決の確認・修正）。
- **大会詳細の名簿表示**（申込者/確定の切替・会員突合のハイライト）。

## 変更履歴

- 2026-07-18: メール大会承認画面で既存系列を正準名・別名から検索し、明示選択して開催へ紐づけられるよう要件を更新（理由: 完全一致時しか候補が使われず、自由入力による確認操作のUXが悪いため）。
