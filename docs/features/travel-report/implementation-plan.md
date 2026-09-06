---
status: completed
design_source: claude-design
---
# travel-report（遠征届）実装手順書

親 Issue: #583（子 #584〜#591）

要件＝[requirements.md](requirements.md)（AC-1〜33）、視覚の正＝[design-spec.md](design-spec.md)＋`design-mock/`（Path D。`remote_pushed: false`＝Claude Design 未 push、ローカル HTML が正）。
詳細コード設計はここに書かない（実装時はコードベースが正）。以下は技術計画（Step 4）で確定した骨子と、タスク分割・Wave。

## 技術計画の骨子

### スキーマ（migration 0064・タスク1に集約）
- `users` 追加: `is_circle_member`（bool・既定 false）／`faculty_kind`（pgEnum `faculty_kind`: undergraduate | graduate、null 可）／`faculty`（text）／`school_year`（text。値は共有定数で検証し pgEnum にしない）／`is_travel_report_submitter`（bool・副連絡責任者。**認可にも使う**）／`is_circle_leader`（bool・サークル長）＋ partial unique index（`WHERE is_circle_leader`。同時に1人の DB バックストップ）
- `entry_group_travel_settings`（PK `entry_group_id`・1:1・行が無ければ既定値）: `required`（既定 true）／`route_input_started_at`／`destination_prefecture`・`destination_city`・`destination_label`／`destination_source`（pgEnum `travel_destination_source`: ai | manual）／**`destination_attempted_at`**（AI 推定の claim。「未試行」と「失敗して空欄」を区別する）／`updated_at`・`updated_by`
- `entry_group_selection_statuses`（PK (`entry_group_id`,`user_id`)）: `status`（pgEnum `travel_selection_status`: confirmed | waitlisted | not_participating）／`updated_at`・`updated_by`。**手入力だけ保存**。有効値の導出は lib の純関数 `deriveEffectiveSelection(manual, rosterRow)`: 手入力 → 取込確定名簿（`superseded_at IS NULL` の確定版）の行を **`status` と `selection_outcome` の両方**で写像（`selection_outcome=waitlisted`→キャンセル待ち／`rejected` または `status∈{cancelled, carry_up_declined}`→不参加／`status∈{confirmed, carried_up}` かつ outcome∉{waitlisted,rejected}→確定／それ以外→確定）→ 名簿行なし（ゲスト・未同定）は確定。「取込名簿の結果に戻す」は**手入力行の DELETE**で実装する（導出値を書き込まない。次の名簿再取込が手入力に隠れないため）
- `travel_routes`（UNIQUE (`entry_group_id`,`unit_start_date`,`user_id`)）: `departure_kind`／`departure_place`／`return_kind`／`return_place`（pgEnum `travel_way_kind`: sapporo | hometown | other）／`legs jsonb`（`$type<TravelLeg[]>`・`[{date,from,to}]`・順序保持。Action 境界で zod 検証: `YYYY-MM-DD`・単位の前後 ±14 日以内・地名 1〜40 文字・行数上限 30）／`saved_at`・`saved_by_user_id`
- `travel_unit_notices`（PK (`entry_group_id`,`unit_start_date`)）: `last_attempted_at`（claim）／`all_entered_notified_at`／`last_error`／`notified_member_count`
- `travel_report_batches`（id・`entry_group_id`・`created_by`・`created_at`・`notified_at`・`notify_error`）＋ `travel_report_documents`（id・`batch_id`・`event_ids jsonb`（0062 の payment_reports と同型）・`filename`・`docx bytea`・`header jsonb`・`member_count`）
- **ON DELETE**: グループ FK は cascade（payment_notices と同じ）、`user_id`（routes・selection_statuses）は cascade、`saved_by`/`updated_by`/`created_by` は set null。enum 名は既存の `selection_outcome`／`lottery_selection_status` と衝突しないよう `travel_` 接頭辞（`faculty_kind` はそのまま）
- `app_settings` キー `travel_report.advisor_department` / `advisor_title` / `advisor_name`
- 共有定数（`packages/shared/src/constants/travel-report.ts`）: 学部候補13・大学院候補21・学年の選択肢（学部 1〜6年／修士1〜2／博士1〜4／専門職1〜3）と並び順・行き／帰りの種別ラベル・団体名「北海道大学かるた会」・出発地既定「札幌」
- 遠征単位＝グループ内の**非 cancelled** 開催日の連続ブロック（グループページの集約と同じ規律）。**キーは `unit_start_date`（ブロック初日）**。単位テーブルは持たず都度導出。開催日の増減で孤児化した経路・通知記録は読まれないだけ（再キー付けは書かない。新ブロックは未通知扱いで再通知＝正しい挙動）

### 認可・境界
- 提出権限者 ＝ admin ∪ vice_admin ∪ （`role === 'member'` ∧ `is_travel_report_submitter` ∧ `deactivated_at IS NULL`）。ゲストにフラグが付いても権限にならない（会員編集画面でもゲストにはチェックを出さない）。`lib/travel-report/authz.ts` の1ヘルパー（フラグは都度 DB。session に載せない。同一 RSC ツリー内は React `cache()` で束ねる）をページ／Server Action／route handler の三箇所で使う。role-preview で member として閲覧中の管理者にフラグがあれば提出権限者 UI が出る（実効ロール規律どおり。コメントに明記）。管理者専用の値・Action は条件下でのみ組み立てる（RSC payload に載せない既存流儀）。スキーマの列コメントで `is_treasurer`（認可に使わない）との対比を明記
- 経路の保存: 本人 ∧ 対象者 ∧ 開いている ／ 提出権限者は代理可。`lib/guest-access.ts` の `events` ケースに `seg.length === 3 && seg[2] === 'travel-route'` の完全一致を追加（`/edit` は開けない）
- middleware は変更しない（ロールで弾いていない）

### 経路・対象者・通知
- `lib/travel-report/units.ts`（純関数: 連続開催日→単位）／`targets.ts`（対象者: サークル所属 ∧ 単位内に attend=true ∧ 有効な確定状況 confirmed）／`routes.ts`（既定行の生成＝本人の出場日基準、保存・読出）／`selection-status.ts`（有効値の導出）／`alerts.ts`（ホーム用）
- 全員そろった通知: `saveTravelRoute` の tx で **`entry_groups` 行を `SELECT … FOR UPDATE`**（settings 行は無いことがありロックできない）→ 対象者を計算 → 遷移判定＝「保存前の未入力の対象者集合 == {保存者}」（保存者が対象者でなければ先に拒否）→ 経路 upsert（＋プロフィール書き戻し）→ 遷移なら `travel_unit_notices.last_attempted_at` を書く（claim）→ **コミット後に** `pushMessagesToEntryGroup`（tx 内で push しない。既存の claim → push → finalize 分離と同型）→ 成功で `all_entered_notified_at`・`last_error=NULL`、失敗で `last_error`。**自己回復**: `last_error IS NOT NULL` かつ保存後に全員入力済みなら遷移でなくても再送する（再送ボタンは無い）。LINE 未紐付け（`loadLinkedBindingForGroup` が null）は送らない。「最後に通知した対象者集合」は持たない（AC-18 の3条件は遷移判定で満たす）。未入力者を「不参加」にして結果的にそろった場合は保存イベントが無いので通知されない（R8 は保存トリガーのみ。S5 の表示で代替）
- メンション: `lib/line-mention-targets.ts` に `resolveSubmitterMention`（`is_travel_report_submitter`）を追加。`buildMentionMessage`（数値・日付だけ差し込み）＋大会名・URL は `buildTextMessage` で別送（payment-notice と同型）。送信は `pushMessagesToEntryGroup`

### docx
- テンプレ: 原本 `.dotx` から団体代表者・顧問教員・電話・令和年・**docProps の creator/lastModifiedBy** を空にした**クリーン版を base64 文字列の TS モジュール**（`lib/travel-report/docx/template.b64.ts`）として同梱（`public/` は認可を掛けられず AC-29 違反、`fs`＋outputFileTracingIncludes は前例が無く本番で初めて壊れる種類の設定）。生成スクリプト `scripts/travel-report/build-template.mjs`（引数に原本パス。原本自体は commit しない）。`entry-form/__fixtures__/fixtures-privacy.test.ts` と同型の PII 不在テストを置く（document.xml と docProps/core.xml の両方）
- `jszip` を `apps/web` の直接依存に追加（`^3.10.1`。lockfile に解決済みだが lockfile の更新を PR に含める）。`lib/travel-report/docx/fill.ts` が document.xml を文字列レベルで「セル書き換え（tcPr・先頭 run の rPr 保持）」「名簿行のクローン（41人以上）」「Content-Types を document に変更」（`scripts/diagnostics/docx_spike.cjs` で検証済み）。**drift ガード**: fill の冒頭で表2枚・行数・セル数を期待値と照合し不一致なら throw（属性付き `<w:tc …>` やネスト表には対応しない前提を明示）
- `lib/travel-report/render.ts`（純関数）: 目的・場所・期間（自至・日数・令和）・人数・名簿の並び（学年順→かな順）・備考の集約（日付順・同内容まとめ・同姓フルネーム・同一日内の順序）／`contacts.ts`（遠征先連絡者・留守連絡先の既定）／`filename.ts`
- 生成物は `travel_report_documents.docx`（bytea）。DL は `api/admin/travel-reports/[id]/route.ts`（提出権限者・RFC 5987）。原本 DL は `api/admin/travel-reports/template/route.ts`（提出権限者）

### AI
- `lib/travel-report/destination-ai.ts`: `ai-extract.ts` と同じ forced tool use（Haiku 4.5・`loadLlmConfig`）。`estimateDestination({ location, title })` → `{prefecture, city, label}` | null。失敗は null。**RSC レンダー中に await しない**: 「経路入力を開始」Action では同期実行、自動オープン（確定名簿あり）の場合は S5 のロードで `UPDATE … SET destination_attempted_at = now() WHERE destination_attempted_at IS NULL` を claim にして Next の `after()` で実行（多重呼び出し防止）。書き込みは `destination_source IS NULL` のときだけ（並行の手入力を潰さない）。`after()` を RSC ページで使う前例は無いので、実装の最初に型と dev 挙動を確認する

### 画面
- S8 `apps/web/src/app/(app)/events/[id]/travel-route/`（page・actions・`RouteForm.tsx` client）
- S6 `apps/web/src/app/(app)/admin/entries/[groupId]/travel-report/new/`（page・actions・`CreateForm.tsx`）
- S5 `admin/entries/[groupId]/components/TravelReportSection.tsx`・`SelectionStatusRows.tsx`（名簿セクション内）＋ `travel-report-actions.ts`
- S7 `components/events/detail/TravelReportCta.tsx`（`events/[id]/page.tsx` にはヘルパーを増やさない規約）
- S9 `dashboard/`（types・page・HomeTimeline に alert 行追加）
- S1 `register/[token]/`（actions・register-form）、S2 `admin/members/[id]/edit/`（edit-member-form・`member-travel-flags-section.tsx`）、S3 `admin/members/`（バッジ・一括編集ページ `admin/members/circle/`）、S4 `settings/travel-report/`＋`lib/travel-report/settings.ts`

## 実装タスク

### タスク1: スキーマ・migration・共有定数・型（共有ホットスポット）
- [ ] 完了
- **目的:** 以後の全タスクが依存する DB 列・テーブル・enum・定数を一度に入れる
- **対応AC:** AC-1〜9・12〜14・19・27（データ基盤）
- **主な変更領域:** `packages/shared/src/schema/`（auth.ts・enums.ts・新規 travel-*.ts 5ファイル・entry-group-selection-statuses.ts・relations.ts・index.ts）、`packages/shared/drizzle/0064_*.sql`（`pnpm db:generate`）、`packages/shared/src/constants/travel-report.ts`、`packages/shared/src/types`、`docs/design/db-tables-auth-line.md`・`db-tables-events.md`・`db.md`（enum 一覧）
- **依存タスク:** なし（main が担当。migration 生成を含む）
- **必要なテスト:** shared の定数テスト（学年の並び順・候補の重複なし）。schema は vitest global-setup の push で検証
- **完了条件:** `pnpm db:generate` で 0064 が1本生成・`pnpm check-types` 通過・テスト DB push 成功
- **対応Issue:** #584
### タスク2: 会員属性とフラグ（S1 登録・S2 会員編集・S3 一覧バッジ＋一括編集）
- [ ] 完了
- **目的:** サークル所属・学部区分・学部等名・学年・（ゲストの姓名）・副連絡責任者・サークル長を登録／編集できるようにする
- **対応AC:** AC-1〜7・31
- **主な変更領域:** `apps/web/src/app/register/[token]/`（actions.ts の parseRegistration／parseGuestRegistration・register-form.tsx）、`apps/web/src/app/(app)/admin/members/[id]/edit/`（actions.ts・edit-member-form.tsx・新規 member-travel-flags-section.tsx・page.tsx）、`apps/web/src/app/(app)/admin/members/page.tsx`（バッジ）、新規 `apps/web/src/app/(app)/admin/members/circle/`（一括編集 page・actions・client 表）、新規 `apps/web/src/components/members/FacultyCombobox.tsx`、`docs/spec/auth-admin.md`
- **依存タスク:** タスク1
- **必要なテスト:** register actions（サークル ON の必須・電話/生年月日の共用・ゲストの姓名）、edit actions（属性保存・サークル長の重複拒否）、一括編集 action（複数人更新・非管理者拒否）、外部 API の回帰（新列が含まれない）
- **完了条件:** 上記テスト green・lint/typecheck 通過・design-spec §10 の S1/S2/S3 指示どおり
- **対応Issue:** #585
### タスク3: 確定状況（S5 名簿セクション内）と有効値の導出
- [ ] 完了
- **目的:** 管理者が確定／キャンセル待ち／不参加を保存でき、遠征届の対象者判定が「有効な確定状況」を使えるようにする
- **対応AC:** AC-8・9（対象者側は タスク5）
- **主な変更領域:** 新規 `apps/web/src/lib/travel-report/selection-status.ts`（導出・読み書き）、`apps/web/src/app/(app)/admin/entries/[groupId]/`（新規 `components/SelectionStatusRows.tsx`・`travel-report-actions.ts` の `saveSelectionStatuses`・page.tsx の名簿セクション）、`docs/spec/events-attendance.md`
- **依存タスク:** タスク1（page.tsx を触るためタスク6と直列）
- **必要なテスト:** 導出の単体（`status`×`selection_outcome` の行列を固定・手入力優先・名簿行なし→確定）、「取込名簿の結果に戻す」＝手入力 DELETE、保存 Action の認可・入力検証。モジュール doc に「dashboard・upcoming-entrants・external API から import しない」を明記
- **完了条件:** テスト green・非管理者に Action/UI が渡らない
- **対応Issue:** #586
### タスク4: 認可ヘルパー・遠征届設定（S4）・テンプレ同梱・原本 DL・ゲスト許可パス
- [ ] 完了
- **目的:** 提出権限者判定と、顧問教員設定、クリーン版テンプレの同梱と配信を先に用意する
- **対応AC:** AC-21（設定・原本部分）・AC-29・AC-30
- **主な変更領域:** 新規 `apps/web/src/lib/travel-report/authz.ts`・`settings.ts`、`apps/web/src/app/(app)/settings/travel-report/`（page・actions・form）、`settings/page.tsx`（リンク。提出権限者にも出す）、`apps/web/src/lib/guest-access.ts`、新規 `scripts/travel-report/build-template.mjs`・`apps/web/src/lib/travel-report/docx/template.b64.ts`、新規 `apps/web/src/app/api/admin/travel-reports/template/route.ts`、`apps/web/package.json`（jszip 追加）、`docs/spec/ui-shell.md`・`auth-admin.md`（ゲスト許可）
- **依存タスク:** タスク1
- **必要なテスト:** authz（admin/vice_admin/member＋フラグ/一般/ゲスト＋フラグ=不可/退会済み=不可）、設定の get/save、原本 route の 403/200、guest-access の許可パス（`/events/:id/travel-route` 可・`/events/:id/edit` 不可）、template.b64 の PII 不在（document.xml と docProps/core.xml。原本の氏名・電話を grep して 0 件）
- **完了条件:** テスト green・`git grep` で原本の電話番号・氏名がリポジトリに無い
- **対応Issue:** #587
### タスク5: 遠征単位・対象者・経路入力（S8）・S7 導線・S9 導線・全員そろった通知
- [ ] 完了
- **目的:** 対象者が経路を入力でき、未入力が目立ち、そろったら LINE で知らせる
- **対応AC:** AC-10（導線側）・11〜18・30
- **主な変更領域:** 新規 `apps/web/src/lib/travel-report/units.ts`・`targets.ts`・`routes.ts`・`alerts.ts`・`notify.ts`、`apps/web/src/lib/line-mention-targets.ts`（`resolveSubmitterMention`）、新規 `apps/web/src/app/(app)/events/[id]/travel-route/`（page・actions・RouteForm）、新規 `apps/web/src/components/events/detail/TravelReportCta.tsx`＋`events/[id]/page.tsx` の1箇所、`apps/web/src/app/(app)/dashboard/`（home-timeline-types・page・HomeTimeline）、`docs/spec/events-attendance.md`・`notifications.md`
- **依存タスク:** タスク1・3・4（main が担当: 複数レイヤー跨ぎ＋LINE）
- **必要なテスト:** units（非 cancelled の連続日の分割）、routes の既定行（行き／帰り 3×3・出場日基準・選択変更で自作行が残る）、legs の zod（±14 日・行数上限・地名長・その他で地名空を拒否）、targets（確定状況×サークル所属×attend）、saveTravelRoute（本人/代理/拒否・開いていない・不要・プロフィール書き戻し）、通知（遷移判定＝保存前の未入力集合=={保存者}・再保存で送らない・対象追加で再送・未紐付けで送らない・push 失敗→次の保存で自己回復・claim がコミット後 push であること）、S7/S9 の描画分岐（RSC payload に管理者値が載らない）
- **完了条件:** テスト green・design-spec §8 の S8/S7/S9 項目
- **対応Issue:** #588
### タスク6: S5 遠征届セクション（必要/不要・開催地 AI 推定・入力開始・入力状況・履歴）
- [ ] 完了
- **目的:** 提出権限者がグループページから運用できる
- **対応AC:** AC-10（トグル）・19・21（トグル・開催地）
- **主な変更領域:** 新規 `apps/web/src/lib/travel-report/destination-ai.ts`、`apps/web/src/app/(app)/admin/entries/[groupId]/`（新規 `components/TravelReportSection.tsx`・`travel-report-actions.ts` に setRequired／startRouteInput／updateDestination・page.tsx）、`docs/spec/events-attendance.md`
- **依存タスク:** タスク3（page.tsx 直列）・タスク5（targets/units/notices の読出）
- **必要なテスト:** AI 推定（SDK モック: 成功・失敗で null・`destination_attempted_at` の claim で1回だけ・`destination_source` が manual なら上書きしない）、各 Action の認可（提出権限者のみ）、不要トグルで導線・通知が止まる、一般会員の RSC payload に名前・履歴が無い
- **完了条件:** テスト green・design-spec §8 の S5 項目
- **対応Issue:** #589
### タスク7: docx 生成（純関数＋テンプレ記入）・作成画面（S6）・作成 Action・DL route・作成通知
- [ ] 完了
- **目的:** 遠征届を作成・保存・ダウンロードでき、LINE で知らせる
- **対応AC:** AC-20〜28
- **主な変更領域:** 新規 `apps/web/src/lib/travel-report/render.ts`・`contacts.ts`・`filename.ts`・`docx/fill.ts`・`docx/read.ts`（テスト用の読み戻し）、新規 `apps/web/src/app/(app)/admin/entries/[groupId]/travel-report/new/`（page・actions・CreateForm）、新規 `apps/web/src/app/api/admin/travel-reports/[id]/route.ts`、`TravelReportSection.tsx`（履歴・作成導線の配線）、`docs/spec/events-attendance.md`・`notifications.md`
- **依存タスク:** タスク4（テンプレ・jszip・authz）・タスク5（targets/routes）・タスク6（セクション）。**純関数群（render/contacts/filename/docx fill）はタスク4完了後に独立して着手可**（別ファイルのため Wave 3 で並行）
- **必要なテスト:** render（期間・令和・人数・名簿並び・備考集約・同姓・同一日内の順序）、contacts（役職順→最年長・同日複数・サークル長遠征時の代替）、docx fill（生成 XML を読み戻して各欄・41人以上の行追加・Content-Types・構造 drift で throw）、作成 Action（分割どおりのファイル数・未入力者の扱い・認可・batch 1件＋documents N件）、DL route の 403/200（RFC 5987）、作成通知（成功で `notified_at`・失敗でも documents は保存され `notify_error`）
- **完了条件:** テスト green・design-spec §8 の S6 項目・`git grep` で原本の個人情報なし
- **対応Issue:** #590
### タスク8: 仕様書更新・INDEX・忠実度チェック・最終回帰
- [ ] 完了
- **目的:** docs レジストリの正典を更新し、design-spec の忠実度チェックリストを全項目確認する
- **対応AC:** AC-31・32・（AC-33 は出荷後の manual）
- **主な変更領域:** `docs/spec/events-attendance.md`（S5〜S9・Server Actions 節）・`auth-admin.md`・`notifications.md`・`ui-shell.md`・`docs/design/db*.md`・`docs/features/INDEX.md`（主要領域）・`docs/SPECIFICATION.md`（必要なら）
- **依存タスク:** タスク2〜7
- **必要なテスト:** なし（CI で全テスト・lint・typecheck）
- **完了条件:** design-spec §8 の全項目にチェック・`docs/` の該当節が実装と一致・CI green
- **対応Issue:** #591
## 実装順序（Wave = 並行実装できるタスクの組）
- Wave 1: タスク1（main。スキーマ・migration）
- Wave 2: タスク2・タスク3・タスク4（互いに変更領域が重ならない: 会員系／グループページ名簿セクション＋lib/selection-status／設定・authz・テンプレ・guest-access）
- Wave 3: タスク5（main）・タスク7の純関数群（render/contacts/filename/docx fill ＋テスト。ページ・Action は含めない）
- Wave 4: タスク6・タスク7の残り（S6 page・作成 Action・DL route・通知）。両方が `TravelReportSection.tsx` を触るため **タスク6 → タスク7 の順で直列**
- Wave 5: タスク8

## 実装への申し送り
- 最初に確認する事実: `/events/[id]/edit` で `event_date` を編集できるか（ブロック初日が動く頻度の見積もり）／進行中ブランチに migration 0064 が無いこと（2026-09-06 時点で無し）／Next 15 の `after()` を RSC ページで使えるか（型と dev 挙動）
- `is_circle_leader` の重複は partial unique index を DB バックストップにし、Action 側で `lib/db-errors.ts` の unique violation を日本語エラーへ変換する（会員編集 Action の既存 tx 内で完結）
- `events/[id]/page.tsx` にはヘルパーコンポーネントを増やさない（`page-padding.test.ts` の制約）。S7 の CTA は `components/events/detail/` に置く
- 提出権限者（一般会員）が `/admin/entries/[groupId]/travel-report/new` と `/settings/travel-report` に入るのは middleware 上は問題ない。ページ側で `loadTravelReportPermission` を必ず通す
- 有効な確定状況の導出は `lib/travel-report/selection-status.ts` の1箇所。`upcoming-entrants.ts` の既存判定は触らない（Non-goal）
- 会計フラグと違い副連絡責任者フラグは認可に使う。スキーマのコメントにその旨を明記する
- Claude Design への push（`features/travel-report/**`）は認可が取れたら行い、design-spec の `remote_pushed` を更新する。実装は `design-mock/*.html` を正として進めてよい
