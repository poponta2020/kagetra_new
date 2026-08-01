---
status: completed
---
# mail-inbox-mailer 実装手順書（2026-08-02 改修: 統合処理フォーム）

要件は [requirements.md](requirements.md)、視覚の正は [design-spec.md](design-spec.md) と
`design-mock/`（A案）。**初版（メーラー化）のタスクは完了済みで git 履歴が持つ。**
本書は今回の改修ぶんで上書きしてある。

## 技術設計の要点（タスク横断の前提）

- **種別は新列。** `mail_messages.mail_kind`（nullable = 未選択）。AI/pre-filter が書く
  `classification` とは別軸で、互いに書き換えない。
- **メールと大会の carrier は `linked_event_id` のまま。** UI では申込グループを選ばせ、
  保存時に `selectRepresentativeEvent` で代表イベントへ解決して入れる。グループは
  `events.entry_group_id` から常に一意に引けるので二重管理しない。これにより
  `EventRelatedMails`（3経路 UNION）は無改修で AC-27 を満たす。
- **配信先の解決は既存のまま。** `broadcastMailToEvent(db, { eventId, ... })` は内部で
  `events → entry_group → event_line_broadcasts` を辿るので、代表イベントを渡せばよい。
- **本文添付は永続化して再送で再現する。** `event_broadcast_messages.include_body` を追加。
  `manualBroadcast` が既に `isCorrection` / `leadText` を保存済み行から継承しているので、
  同じ規約に乗せる。さらに **prefix-skip（`!force` かつ既配信あり）が効く経路では
  保存値を優先**して列を再構成する（args を信じると再送で読み飛ばし位置がずれる）。
- **級未選択はグループ統一。** 新 UI に「取込単位」ラジオは無いので、フォームは級ゼロ選択を
  `null` として送る。**`[]` を送ってはならない**（`normalizeAdoptionGrades` は `[]` を
  入力ミスとして弾く既存契約）。
- **client-safe 純関数の制約。** 候補フィルタの純関数は `@kagetra/shared/schema` を
  **型 import も含めて**参照しない（lint / vitest / typecheck では検知できず `next build` で
  初めて壊れる既知の罠）。`roster-adopt-utils.ts` 冒頭と同じ警告コメントを付ける。

## 実装タスク

### タスク1: スキーマとマイグレーション
- [x] 完了
- **目的:** 種別列と本文添付フラグを持たせる
- **対応AC:** AC-1, AC-15, AC-17, AC-26
- **主な変更領域:** `packages/shared/src/schema/enums.ts` / `schema/mail-messages.ts` /
  `schema/event-broadcast-messages.ts` / `packages/shared/drizzle/0055_*.sql`
- **依存タスク:** なし
- **必要なテスト:** スキーマ単体テストは不要。マイグレーションが適用できること
- **完了条件:**
  - `mailKindEnum = pgEnum('mail_kind', ['tournament_notice','applicant_roster','confirmed_roster'])`
  - `mail_messages.mail_kind`（nullable）・`event_broadcast_messages.include_body`
    （`notNull().default(true)`）
  - `drizzle-kit generate` 済み。採番は **0055**（0054 が最新）
  - 型チェック green。列リネームではないので対話プロンプトは出ない想定（出たら中断して報告）
- **対応Issue:** #441

### タスク2: 候補グループのローダと種別別フィルタ
- [x] 完了
- **目的:** 「対象の大会」候補を申込グループ単位で1本にまとめ、種別で出し分けられるようにする
- **対応AC:** AC-5, AC-6, AC-7, AC-18
- **主な変更領域:**
  - 新規 `apps/web/src/app/(app)/admin/mail-inbox/process-candidates.ts`（サーバー・DB）
  - 新規 `apps/web/src/app/(app)/admin/mail-inbox/process-candidate-utils.ts`（**client-safe 純関数**）
  - 既存 `roster-adopt-utils.ts` の4象限フィルタを再利用または移設
- **依存タスク:** なし（`mail_kind` 列に依存しない。種別は引数で受ける）
- **必要なテスト:** 純関数の単体テスト。種別=未選択で団体戦のみのグループが候補に残ること／
  名簿種別では落ちること、既定フィルタと「すべて表示」の切替、LINE 未紐付けフラグ
- **完了条件:**
  - 母集団 = 「開催日 ≥ cutoff ∧ status≠cancelled」を満たす日を1つ以上持つ entry_group
    （**団体戦のみのグループも含む** — 未選択種別の紐付けは個人戦に限る理由がない）
  - DTO に `groupId / displayName / representativeEventId / days[] / files[] / lineLinked`
  - `displayName` の導出規約は既存 `loadRosterAdoptableGroups` と同一
  - `lineLinked` は `event_line_broadcasts.status='linked'` の有無
  - **`process-candidate-utils.ts` が `@kagetra/shared/schema` / `drizzle-orm` / `@/lib/*` を
    一切 import していない**（`grep` で確認。`Grade` は自前定義）
- **対応Issue:** #442

### タスク3: LINE 配信の本文添付フラグ
- [ ] 完了
- **目的:** 本文を送る／送らないを選べるようにし、再送でも同じ構成を再現する
- **対応AC:** AC-16, AC-17, AC-30
- **主な変更領域:** `apps/web/src/lib/line-broadcast.ts` /
  `apps/web/src/app/(app)/events/[id]/actions.ts`（`manualBroadcast` の継承）
- **依存タスク:** タスク1
- **必要なテスト:**
  - `includeBody=false` で本文画像・本文テキストが列に入らず、lead + 添付リンクだけになる
  - **★回帰の要:** `status='partial'` かつ `include_body=true` の監査行に対し、
    `args.includeBody=false` で `!force` 再送しても、組み立てられる列が初回と一致する
  - `includeBody=true` の既存挙動（画像化 → 失敗時テキストフォールバック → 添付リンク）が不変
  - 本文OFF・lead 無し・添付無し → `skipped` を返し `sent` にしない
- **完了条件:**
  - `broadcastMailToEvent` の args に `includeBody?: boolean`（既定 true）
  - upsert で `include_body` を保存
  - **prefix-skip が効く経路（`!force` かつ `deliveredCount > 0`）では保存値を優先**
  - `manualBroadcast` が `include_body` も既存行から継承する
  - 空の列になったら distinct な reason で `skipped` を返し、`sent` にしない
- **対応Issue:** #443

### タスク4: Server Actions（実行・undo・AI 抽出）
- [ ] 完了
- **目的:** 1 回の実行で 種別保存・大会紐付け・名簿一括採用・LINE 配信を行い、undo で戻す
- **対応AC:** AC-2, AC-9, AC-10, AC-11, AC-12, AC-14, AC-19, AC-21, AC-22, AC-24, AC-28
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`
- **依存タスク:** タスク1, タスク2, タスク3
- **必要なテスト:**
  - 実行で mail_kind / linked_event_id / triage=processed が入る
  - 名簿 N 件が 1 回で採用される。1 件失敗で**全体ロールバック**（部分採用が残らない）
  - 級未選択の添付が `grades=null` で採用される
  - 配信 OFF で `broadcastMailToEvent` が呼ばれない／ON で `includeBody` が渡る
  - LINE 未紐付けグループに配信 ON を送るとサーバー側で拒否される
  - 未完了 draft があるメールへの実行が拒否される
  - undo で mail_kind / linked_event_id / 当該メール由来の採用が消える
  - AI 抽出起動で mail_kind='tournament_notice' が入り、triage は unprocessed のまま
- **完了条件:**
  - `processMail(mailId, input)` を新設。**1 つの `db.transaction`** で全部行い、
    `revalidatePath` は **commit 後に 1 回だけ**（N 回呼ばない）
  - 名簿採用は `adoptRosterFile` から抽出した `adoptRosterFileTx(tx, …)` を再利用。
    UNIQUE / FK 違反のメッセージに**どのファイルか**を含める
  - 代表イベントの解決は `selectRepresentativeEvent`
  - `undoTriage` を拡張（mail_kind / linked_event_id / 当該メール由来の
    `tournament_entry_roster_files` を削除）
  - `triggerExtractDraft` が mail_kind を保存
  - `linkMailToEvent` は撤去（`processMail` が置換）。`dismissMail` / `releaseRosterFile` /
    `unlinkMailFromEvent` の扱いは実装時に整理し、死にコードを残さない
- **対応Issue:** #444

### タスク5: メール詳細画面の統合フォーム
- [ ] 完了
- **目的:** design-mock の A案 を実コードに移植する
- **対応AC:** AC-1, AC-3, AC-4, AC-5, AC-8, AC-9, AC-13, AC-14, AC-15, AC-18, AC-20, AC-23, AC-25, AC-26, AC-31
- **主な変更領域:**
  - 新規 `components/MailProcessForm.tsx`・`components/GroupPickerSheet.tsx`
  - `mail/[id]/page.tsx`（候補ロード・種別ピル・分岐の作り替え）
  - 撤去: `components/MailDetailActions.tsx` / `components/ExistingEventLinkSheet.tsx` /
    `components/RosterFileAdoptSheet.tsx`（**採用済み状態の表示だけは移設**）
  - 再利用: `AIExtractConfirmDialog` / `BROADCAST_LEAD_PRESETS` / `Card` `Btn` `Pill`
- **依存タスク:** タスク2, タスク4
- **必要なテスト:** フロントテスト（種別ごとの欄の出し分け、LINE 未紐付けで配信が選べない、
  級未選択が `null` として送られる、結果取込が種別=未選択のときだけ出る、
  未完了 draft でフォームが出ない）
- **完了条件:**
  - **design-spec の `## 忠実度チェックリスト` 全項目クリア**
  - モックと同じトークン変数を使う（値を読み取って書き直さない）
  - **既に採用済みの添付**はファイルリスト内に採用状態行（種別ピル・級ピル・解除ボタン）
    として出す（モックに無い状態。既存 `RosterFileAdoptSheet` の採用済みカードの意匠を移設）
  - 「本文を添付しない」かつ添付ゼロのときは冒頭メッセージを必須にする
    （空配信をサーバーまで運ばない）
  - ボトムシートは `createPortal(document.body)` + `.modal-overlay-h`、
    スクロールコンテナに `min-h-0`（既存規約）
- **対応Issue:** #445

### タスク6: 一覧の種別ピル差し替え
- [x] 完了
- **目的:** 一覧の区分ピルを AI 由来から手動種別へ変える
- **対応AC:** AC-26
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/page.tsx`
- **依存タスク:** タスク1
- **必要なテスト:** 種別ありでピルが出る／未選択で出ない
- **完了条件:** `classification` ピルを撤去し `mail_kind` ピルにする（`classification` 列は残す）
- **対応Issue:** #446

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1:** タスク1（`packages/shared`）, タスク2（mail-inbox 配下の新規ファイル）— 変更領域が重ならない
- **Wave 2:** タスク3（`lib/line-broadcast.ts` + `events/[id]/actions.ts`）,
  タスク6（`admin/mail-inbox/page.tsx`）— 変更領域が重ならない
- **Wave 3:** タスク4（`admin/mail-inbox/actions.ts` 単独）
- **Wave 4:** タスク5（`mail/[id]/page.tsx` + components）
