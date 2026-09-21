---
status: completed
---
# invite-link-registration 実装手順書（2026-09-21 改修: 名簿から選んで紐付け＋サークル所属入力）

> 初版（PR #182）のタスクは完了済みで、git 履歴にある。本書は今回の改修分で上書きした。
> 要件の正典は [requirements.md](./requirements.md)（AC は §4）。design-spec は作らない（画面の組み方は requirements 末尾）。

## 技術設計の要点

- **DB**: スキーマ変更なし・migration なし。使う列: `users.line_user_id`・`line_linked_at`・`line_link_method`・`is_circle_member`・`faculty_kind`・`faculty`・`school_year`・`phone`・`birth_date`・`updated_at`。
- **共通モジュール（サーバー）** `apps/web/src/lib/roster-claim.ts`:
  - `listRosterCandidates(): Promise<RosterCandidate[]>` — 条件 `line_user_id IS NULL ∧ is_invited ∧ deactivated_at IS NULL`、氏名の昇順。返すのは `{ id, name, needsPhone, needsBirthDate }` だけ（`needsPhone = phone IS NULL`、`needsBirthDate = birth_date IS NULL`）。値そのものは select 結果から外して返す。
  - `claimRosterMember({ lineUserId, method, formData })` — 1トランザクションで次を行う。
    1. `userId` を formData から読む。
    2. 候補条件つきで `SELECT id, phone IS NULL, birth_date IS NULL ... FOR UPDATE` する。0件なら `{ kind: 'unavailable' }` を返す。
    3. DB の空欄の印を使って入力を検証する（下記 `parseRosterClaimInput`）。エラーなら `{ kind: 'invalid', message }`（UPDATE しない）。
    4. 候補条件つきで UPDATE する。更新するのはホワイトリストの列だけ（紐付け3列・サークル4列・空だった phone/birth・updated_at）。サークル所属 OFF のときは `is_circle_member=false` だけで、学部等には触れない。
    5. `line_user_id` の UNIQUE 違反は `{ kind: 'duplicate' }`。成功時は `{ kind: 'ok', linkedAt }`。
- **共通モジュール（純関数・クライアント安全）** `apps/web/src/lib/roster-claim-input.ts`:
  - `export type RosterCandidate = { id: string; name: string | null; needsPhone: boolean; needsBirthDate: boolean }`
  - `parseRosterClaimInput(formData, { needsPhone, needsBirthDate })` — サークル所属 ON のとき、学部区分・学部等名（1〜50）・学年（`isSchoolYearForKind`）を必須にする。needs の立っている電話・生年月日も必須にする。エラー文言は `registerViaInvite` のサークル所属分と同じにする。
  - `node:*` を import しない（client component が型を import するため。[[feedback_node_import_breaks_client_bundle]]）。
- **検証ヘルパーの共有** `apps/web/src/lib/profile-validators.ts`: `registerViaInvite` 内のローカル関数 `validateBirthDate` と電話の検証（`PHONE_RE`＋10〜13桁）を**挙動を変えずに**ここへ移し、`registerViaInvite` と `parseRosterClaimInput` の両方から使う（`'use server'` ファイルからは非 async を export できないため lib へ置く）。
- **Server Action**:
  - `/register/[token]/actions.ts` に `claimViaInvite(token, prev, formData)` を新設する。セッションのガード（紐付け済みなら `/`、lineUserId が無ければ `/register/<token>`）→ トークンを再検証（無効なら既存の「招待リンクの有効期限が切れています。」、`kind==='guest'` なら拒否）→ `claimRosterMember({ method: 'invite_link' })` → 成功時は既存の `finishRegistration(now)`。`unavailable` のときは `revalidatePath` で候補を出し直す。
  - `registerViaInvite`（会員用の分岐）: 氏名の UNIQUE 違反のとき、衝突相手が名簿の候補（未紐付け・招待済み・未退会）なら `{ error: '名簿に同じお名前があります。『名簿から選ぶ』から選んでください。', suggestRoster: true }` を返す。それ以外は既存の文言。`RegisterViaInviteState` に `suggestRoster?: boolean` を足す。ゲストの分岐は触らない。
  - `/self-identify/actions.ts` の `claimMemberIdentity` を `(prev, formData) => Promise<{ error?: string }>` に変え、`claimRosterMember({ method: 'self_identify' })` を使う。エラー文言は今の `ERROR_MESSAGES`（unavailable / duplicate / invalid_input）を流用し、検証エラーは parse のメッセージを返す。成功時は今と同じ（`unstable_update` → `revalidatePath('/')` → `redirect('/')`）。
- **UI**:
  - A-flat 部品（`Field`・`UnderlineInput`・`UnderlineSelect`・`SegmentGroup`・`BoxlessCheckbox`・`UNDERLINE_INPUT_CLASS`）を `register-form.tsx` から `apps/web/src/components/register/flat-fields.tsx` へ**マークアップを変えずに**移し、export する。`register-form.tsx` は import に置き換えるだけにする。
  - `apps/web/src/components/register/RosterClaimForm.tsx`（client）: props は `{ action, candidates: RosterCandidate[], submitLabel }`。`useActionState(action)` を使い、入力は controlled（エラー時も保持）。構成は検索欄 → 氏名ラジオ一覧（`name="userId"`）→ サークル所属チェック（`name="isCircleMember"`）→ ON なら学部区分（`facultyKind`）・学部等名（`FacultyCombobox` / `faculty`）・学年（`schoolYear`）→ 選んだ候補の `needsPhone`/`needsBirthDate` が true のときだけ電話（`phone`）・生年月日（`birthDate`）の欄 → 送信ボタン。
  - `/register/[token]/page.tsx` の分岐4: `kind==='member'` なら `listRosterCandidates()` を呼ぶ。候補が1人以上なら新設の `MemberRegisterEntry`（client, `register/[token]/member-register-entry.tsx`）を描く。これは2択（下線セグメント「名簿から選ぶ」「新しく登録する」＋補助文、既定の選択なし）と、選んだ側のフォーム（`RosterClaimForm` に `claimViaInvite.bind(null, token)`、または `RegisterForm`）を出す。候補0人なら今どおり `RegisterForm` だけ。ゲストは今どおり。
  - `RegisterForm` に任意 prop `onSwitchToRoster?: () => void` を足す。`state.suggestRoster && onSwitchToRoster` のとき、エラー文の直下に「名簿から選ぶ」ボタンを出す。
  - `/self-identify/page.tsx`: 外枠・見出し・説明文・候補0人の表示は変えない。一覧を `RosterClaimForm`（`submitLabel="このメンバーとして続ける"`）へ置き換え、`searchParams` によるエラー表示を撤去する（エラーは action の state で出す）。`candidate-list.tsx` は削除する。
- **既存テストへの影響**: `self-identify/actions.test.ts` は送信処理の形が変わる（リダイレクト → state）ため、AC-8 に合わせて書き換える（承認済みの仕様変更による書き換え）。E2E の `invite-link-registration.spec.ts` は、招待発行者のフィクスチャ（`seedInvite` の `createUser`）に `lineUserId` を入れて候補から外すことで、既存の登録ケースを無変更で通す。同名ケースは AC-11 に合わせて更新する。

## 実装タスク

### タスク1: 名簿紐付けの共通モジュール（サーバー＋純関数）
- [x] 完了
- **目的:** 候補の取得・入力の検証・紐付けの保存を1か所にまとめ、S2a・S3 から同じ処理を呼べるようにする。
- **対応AC:** AC-2, AC-4, AC-5, AC-6（サーバー側）, AC-7, AC-9
- **主な変更領域:** `apps/web/src/lib/profile-validators.ts`（新規）・`apps/web/src/lib/roster-claim-input.ts`（新規）・`apps/web/src/lib/roster-claim.ts`（新規）・各 `.test.ts`・`apps/web/src/app/register/[token]/actions.ts`（`validateBirthDate`/電話検証を import に置き換えるだけ。挙動不変）
- **依存タスク:** なし
- **必要なテスト:**
  - `profile-validators.test.ts`（純）: 生年月日（形式・実在日・1900年未満・未来日）と電話（文字種・桁数）が `registerViaInvite` の現行の境界と同じであること。
  - `roster-claim-input.test.ts`（純）: サークル所属 OFF は学部なしで通る。ON は3項目必須で、区分と合わない学年は拒否。needsPhone/needsBirthDate が true のときだけ電話・生年月日が必須。
  - `roster-claim.test.ts`（DB）: 候補条件（未招待・退会済み・紐付け済みは出ない）と、返り値のキーが `id,name,needsPhone,needsBirthDate` だけであること（AC-2）。紐付け成功で、ホワイトリスト外の全列が変わらないこと（更新前後の行を全列比較、AC-4）。値が入っている電話・生年月日は送っても変わらず、空なら書かれること。サークル ON/OFF の保存（AC-5/7）。検証エラー時・候補外（他人が紐付け済み）のとき何も変わらないこと（AC-9）。同じ lineUserId が別行にある場合は `duplicate` になること。
- **完了条件:** 上記テストと既存の `register/[token]/actions.test.ts` が green、`pnpm check-types` 通過。
- **対応Issue:** #654

### タスク2: 共有フォーム部品（A-flat 部品の切り出し＋RosterClaimForm）
- [ ] 完了
- **目的:** S2a・S3 で共用する名簿選択フォームを作る。登録フォームの A-flat 部品を共有ファイルへ移す。
- **対応AC:** AC-6（画面側）, AC-8（入力保持の土台）
- **主な変更領域:** `apps/web/src/components/register/flat-fields.tsx`（新規）・`apps/web/src/components/register/RosterClaimForm.tsx`（新規）・`RosterClaimForm.test.tsx`（新規）・`apps/web/src/app/register/[token]/register-form.tsx`（部品を import に置き換えるだけ。マークアップ不変）
- **依存タスク:** なし（`RosterCandidate` 型はタスク1が `apps/web/src/lib/roster-claim-input.ts` に置く。形は上記「技術設計の要点」のとおりで、`import type` で参照する）
- **必要なテスト:** `RosterClaimForm.test.tsx`（jsdom）: 検索で一覧が絞られる。サークル所属 ON で学部区分・学部等名・学年が出る。needsPhone の候補を選んだときだけ電話欄が出る（生年月日も同様）。needs が false の候補では出ない。action が error を返したとき入力値が保持され、エラーが表示される。既存の `register-form.test.tsx` が無変更で green。
- **完了条件:** 上記テスト green、`pnpm --filter=@kagetra/web exec eslint` と `pnpm check-types` 通過。
- **対応Issue:** #655

### タスク3: 招待登録ページへの組み込み（S2 / S2a / S2b）
- [ ] 完了
- **目的:** 招待URLで名簿から選んで紐付けられるようにし、同名時に名簿へ誘導する。
- **対応AC:** AC-1, AC-2（ページ側）, AC-3, AC-10, AC-11, AC-13, AC-14, AC-15（`/register` 側）
- **主な変更領域:** `apps/web/src/app/register/[token]/actions.ts`（`claimViaInvite` 新設・`registerViaInvite` の同名分岐・state 型）・`page.tsx`・`member-register-entry.tsx`（新規）・`register-form.tsx`（`onSwitchToRoster` prop とボタン）・`actions.test.ts`（追加のみ）・`page.test.tsx`（新規）
- **依存タスク:** タスク1, タスク2
- **必要なテスト:**
  - `actions.test.ts` への追加: `claimViaInvite` で method が `invite_link` になり、行数が増えない（AC-3）。期限切れ・取消済みでは拒否され紐付かない（AC-10）。ゲスト用トークンでは拒否。未ログイン・紐付け済みのガード。`registerViaInvite` で名簿の候補と同名なら名簿誘導の文言＋`suggestRoster`、紐付け済み・退会済みと同名なら既存の文言（AC-11）。既存テストは変更しない（AC-14）。
  - `page.test.tsx`（新規）: 会員用・未紐付けで候補ありなら2択が出る。候補0人なら登録フォームだけが出る（AC-1）。ページの出力に候補の級・住所・電話の値が含まれない（AC-2）。ゲスト用はゲストフォームのまま（AC-13）。無効トークン表示・紐付け済みは `/` へのリダイレクト（AC-15）。
- **完了条件:** 上記テストと既存の `register-form.test.tsx`・`actions.test.ts` が green、lint・check-types 通過。
- **対応Issue:** #656

### タスク4: 本人選択画面（/self-identify）への組み込み（S3）
- [ ] 完了
- **目的:** トップからログインした名簿の会員にも、同じサークル所属の入力をさせる。
- **対応AC:** AC-8, AC-9（S3 側）, AC-15（`/self-identify` 側）
- **主な変更領域:** `apps/web/src/app/self-identify/actions.ts`（state 型へ変更・共通モジュール利用）・`page.tsx`（`RosterClaimForm` へ置き換え・searchParams のエラー表示撤去）・`candidate-list.tsx`（削除）・`actions.test.ts`（AC-8 に合わせて書き換え）・`page.test.tsx`（新規）
- **依存タスク:** タスク1, タスク2
- **必要なテスト:** `actions.test.ts`: method=`self_identify` で紐付き、更新列がホワイトリストに収まる。サークル ON の必須と入力保持用の error state。未招待・退会済み・紐付け済みは今と同じ文言の error state で DB 無変化（AC-9）。lineUserId 無し → `/auth/signin`、紐付け済み → `/` のガード。`page.test.tsx`: 候補条件が変わらない、候補0人の表示が変わらない、見出しと送信ボタンの文言が変わらない（AC-15）。
- **完了条件:** 上記テスト green、lint・check-types 通過。`git grep candidate-list` が 0 件。
- **対応Issue:** #657

### タスク5: E2E（招待URLの名簿選択・同名誘導・self-identify の回帰）
- [ ] 完了
- **目的:** 実ブラウザで一連の流れを通し、既存の E2E が壊れていないことを確かめる。
- **対応AC:** AC-11（E2E 側）, AC-12, AC-13〜AC-15（E2E 回帰）, AC-16
- **主な変更領域:** `apps/web/e2e/invite-link-registration.spec.ts`・`apps/web/e2e/self-identify-flow.spec.ts`
- **依存タスク:** タスク3, タスク4
- **必要なテスト:**
  - invite: `seedInvite` の発行者に `lineUserId` を入れて候補から外す（既存の各級の登録ケースを無変更で通すため）。新規ケース「名簿の会員 → 名簿から選ぶ → サークル所属 ON で学部等を入力 → ダッシュボード、DB に `invite_link` と学部等」（AC-12）。同名ケースを AC-11 に更新（名簿の候補と同名 → 誘導文言 → 「名簿から選ぶ」で名簿へ切り替わる）。
  - self-identify: 既存ケースが通ることを確認し、「サークル所属 ON で学部等を入れて紐付く」ケースを1つ追加。
- **完了条件:** E2E は CI で green（ローカルでの E2E 実行は要求しない）。lint・check-types 通過。
- **対応Issue:** #658

## 実装順序（Wave = 並行実装できるタスクの組）
- Wave 1: タスク1, タスク2（互いに依存なし。タスク1 は `lib/`＋`register/[token]/actions.ts`、タスク2 は `components/register/`＋`register/[token]/register-form.tsx` で、変更ファイルが重ならない）
- Wave 2: タスク3, タスク4（どちらもタスク1・2 に依存。タスク3 は `app/register/`、タスク4 は `app/self-identify/` で、変更ファイルが重ならない）
- Wave 3: タスク5（タスク3・4 に依存）
