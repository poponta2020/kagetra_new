---
status: completed
---

# guest-role 実装手順書

要件定義書: [requirements.md](requirements.md)（AC は §4・全 37 件 auto-test）

## 実装タスク

### タスク1: 基盤（enum・型・招待種別列・migration）

- [x] 完了
- **目的:** `guest` ロールと招待リンク種別を DB スキーマと TypeScript 型の両方で表現できるようにする。**全タスクの土台**（共有ホットスポットなのでここだけ先行させる）。
- **対応AC:** AC-1, AC-27, AC-36（JWT 層の拒否）
- **主な変更領域:**
  - `packages/shared/src/schema/enums.ts`（`userRoleEnum` に `guest` 追加、`registrationInviteKindEnum`(`member`/`guest`) 新設）
  - `packages/shared/src/schema/registration-invites.ts`（`kind` 列: NOT NULL DEFAULT `'member'`）
  - `packages/shared/drizzle/`（migration 0057）
  - `apps/web/src/lib/role-preview.ts`
  - `apps/web/src/next-auth.d.ts`
  - `apps/web/src/test-utils/seed.ts`（`createUser` が `role: 'guest'` を受けられること。後続タスクが全部使う）
- **依存タスク:** なし
- **必要なテスト:** `role-preview` の純関数テスト —— `parseUserRole('guest')` が `'guest'` を返す／`selectableRoles('admin')` に `guest` が**含まれない**／`roleViewLabel('guest') === 'ゲスト'`／`buildRolePreviewSelection` が `realRole='guest'` で `null` を返す／`resolveEffectiveRole('guest', 'admin')` が `'guest'` へ丸められる（昇格不能）
- **完了条件:** migration が生成されテスト DB へ適用でき、`check-types` と既存テストが green
- **実装上の注意:**
  - ⚠️ **`parseUserRole` は `guest` を受理し、`ROLES_HIGH_TO_LOW` には `guest` を入れない**。この2つは同じファイル内で逆を向いているので、両方の理由をコメントで残すこと。前者は `resolveEffectiveRole` が実効ロールを正しく `'guest'` にするために必須（受理しないと `session.user.role` が `'guest'` として下流の認可に届かない）。後者は `auth.config.ts` の JWT 更新経路が `selectableRoles(realRole).includes(requested)` で判定しているため、含めないことがそのまま AC-36 の拒否になる。
  - `ALTER TYPE "user_role" ADD VALUE 'guest'` は単独ステートメントで発行し、**同じ migration 内で `'guest'` を参照しない**（列のデフォルト・CHECK などに使わない）。`drizzle-kit generate` の出力が値参照を含んでいた場合のみ migration を分割する。
  - 招待種別は `user_role` の再利用ではなく専用 enum にする（招待リンクで作れるのは `member` か `guest` だけで、`admin` を入れられる形にしない）。
- **対応Issue:** #481

### タスク2: ゲストのアクセス制御（許可リスト・middleware・API・ページガード）

- [x] 完了
- **目的:** ゲストが許可された画面・API 以外に到達できないようにする。**fail-closed の許可リスト**で、今後画面が増えても既定で閉じている状態にする。
- **対応AC:** AC-9（middleware 側）, AC-10, AC-11, AC-30, AC-33, AC-34, AC-35
- **主な変更領域:**
  - `apps/web/src/lib/guest-access.ts`（**新規**・純関数・Edge safe。DB / next-auth / process.env を import しない）
  - `apps/web/src/middleware.ts`
  - `apps/web/src/app/api/mail/attachments/[id]/route.ts` と `.../preview/[page]/route.ts`
  - `apps/web/src/app/(app)/mail/**`・`players/**`・`tournaments/**` のページ側ガード
  - ※ `/dashboard` の Node 側ガードは**タスク7**が持つ（同じファイルを触るため）
- **依存タスク:** タスク1
- **必要なテスト:** 許可判定の純関数（`/events` 許可・`/events/new` と `/events/<id>/edit` は**拒否**・`/settings` 完全一致のみ許可で `/settings/notifications` は拒否・`/api/roster-files/...` 許可・`/api/mail/...` 拒否）／middleware がゲストを `/403` へ送る／API ルートがゲストのセッションで 403 を返し会員では従来どおり 200
- **完了条件:** 上記テストが green、既存の middleware テスト（未認証・未紐付け・`/register`）が回帰しない
- **実装上の注意:**
  - **二段構え**にする。middleware（Edge）が読む `token.role` は Node 側の jwt callback が DB から再同期するまで stale になりうるため、middleware は早期ゲート（UX）と位置づけ、**Node 側（route handler・ページ）でも `session.user.role === 'guest'` を判定**する。
  - middleware は API とページで応答を変える —— `/api/` で始まるパスは 403 の JSON、それ以外は `/403` へリダイレクト。
  - `api/mail/attachments` の2本は「意図的な admin ルートのコピーで、`attachment-route-parity.test.ts` が両者のヘッダ一致を守っている」という既存契約がある。**認可の追加が parity テストを壊さないこと**を確認する（壊れる場合はテスト側の期待を認可差分だけ更新し、ヘッダの契約は変えない）。
- **対応Issue:** #482

### タスク3: ゲスト用招待リンクの発行と登録フロー

- [x] 完了
- **目的:** 管理者がゲスト用の招待リンクを発行でき、そのリンクから本人が3項目でゲスト登録できるようにする。
- **対応AC:** AC-2, AC-3, AC-4, AC-5, AC-6, AC-7
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/members/actions.ts`（`createRegistrationInvite` に種別、`listActiveRegistrationInvites` が種別を返す）
  - `apps/web/src/app/(app)/admin/members/registration-invite-section.tsx`（種別セレクト・一覧の種別表示）
  - `apps/web/src/app/(app)/admin/members/page.tsx`（招待セクションへの受け渡しのみ。ロール列は `roleViewLabel` 経由なのでタスク1で対応済み）
  - `apps/web/src/app/register/[token]/{page.tsx,register-form.tsx,actions.ts}`
- **依存タスク:** タスク1
- **必要なテスト:** ゲスト用発行で `kind='guest'` が保存される／ゲスト用トークンのページが3項目フォームを描画し PII 入力欄を描画しない／登録で `role='guest'`・`is_invited=true`・`grade`・`affiliation` が入り PII 列が NULL／級・所属会の未入力を拒否／表示名の UNIQUE 衝突で日本語エラー／**会員用トークンの既存挙動が完全に不変**
- **完了条件:** 上記テストが green、既存の `actions.test.ts` / `register-form.test.tsx` が回帰しない
- **実装上の注意:**
  - `registerViaInvite` は**トークンから `kind` を引き直して分岐する**。クライアントが送ったフォーム値で種別を決めない（ゲスト用リンクから会員として登録される経路を作らない）。
  - ゲスト分岐では `familyName` / `givenName` / `familyKana` / `givenKana` / `dan` / `zenNichikyo` / `gender` / `birthDate` / `phone` / `postalCode` / `address1` / `address2` を**一切書かない**（既定の NULL / false のまま）。
  - 表示名は `users.name` にそのまま入れる。入力欄のガイドに「姓と名の間にスペース」を書く（苗字チップの導出が最初の空白で分割するため。requirements R1）。
- **対応Issue:** #483

### タスク4: ナビ・設定・ログイン後の入口

- [x] 完了
- **目的:** ゲストのボトムナビを2タブにし、設定を表示のみにし、ログイン直後に `/events` へ着地させる。
- **対応AC:** AC-8, AC-11（`/settings` 到達）, AC-24
- **主な変更領域:**
  - `apps/web/src/components/layout/bottom-nav.tsx`（タブの可視条件をロールで表現）
  - `apps/web/src/components/layout/mobile-shell.tsx`
  - `apps/web/src/app/(app)/layout.tsx`（`isAdmin` だけでなくロールを渡す）
  - `apps/web/src/app/(app)/settings/page.tsx`（ゲスト向けの表示のみビュー）
  - `apps/web/src/app/page.tsx`（`/` の着地先をロールで振り分け）
- **依存タスク:** タスク1
- **必要なテスト:** ゲストのナビが「イベント」「設定」の2タブだけ／会員5タブ・管理者6タブが不変／ゲストの設定画面に表示名・級・所属会が表示のみで出て編集フォーム・通知設定・申込書設定・会員一覧への導線が無い／`/` がゲストを `/events` へ、会員を `/dashboard` へ送る
- **完了条件:** 上記テストが green、既存のナビ・設定ハブのテストが回帰しない
- **実装上の注意:** ゲストの設定画面には**通知設定への導線を置かない**（requirements R6。ゲストは Web Push を購読する経路自体を持たない）。表示ロールのプレビューセクションはタスク1の `buildRolePreviewSelection` が `null` を返すので自然に消える。
- **対応Issue:** #484

### タスク5: 大会詳細（回答条件・ゲスト印・参加費非表示）

- [x] 完了
- **目的:** ゲストが会内締切に縛られず回答でき、参加者欄にゲスト印つきで並び、参加費の行は出ないようにする。
- **対応AC:** AC-12, AC-13, AC-14, AC-15, AC-16
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/page.tsx`・`actions.ts` と配下コンポーネント
- **依存タスク:** タスク1
- **必要なテスト:** ゲストが会内締切超過の大会に回答できる／対象級外は Server Action を直接呼んでも拒否／**一般会員は従来どおり締切超過で拒否**（回帰）／参加者欄にゲスト印が出て人数に含まれる／ゲストに「あなたの参加費」が描画されず RSC payload にも金額が載らない
- **完了条件:** 上記テストが green、`page.test.tsx` / `actions.test.ts` の既存ケースが回帰しない
- **実装上の注意:**
  - `canRespond` の分岐はページと `submitAttendance` の**両方**にある。片方だけ直すと UI と実際の可否がずれる（既存コードが「クライアント側の判定をサーバーで信頼しない」方針を明示している）。
  - `eligibleUsers` のクエリ（`is_invited=true` ∧ 対象級）は**変更不要** —— ゲストも `is_invited=true` なので自然に参加者欄へ載る。
  - 回答不可の理由表示から、ゲストのときだけ「会内締切超過」を出さない。
- **対応Issue:** #485

### タスク6: 会の申込作業からの除外（E1〜E5）★本機能の核

- [ ] 完了
- **目的:** 申込書 xlsx・参加費集計・申込管理ボード・未申込督促からゲストを確実に外す。
- **対応AC:** AC-17, AC-18, AC-19, AC-20, AC-23
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/entry-form/[groupId]/actions.ts`（E1）
  - `apps/web/src/lib/entry-fee-tally.ts`（E2）
  - `apps/web/src/app/(app)/admin/entries/page.tsx`（E3）
  - `apps/web/src/lib/entry-overdue-alert.ts`（E4）
  - `docs/features/grade-entry-fee/requirements.md`（AC-9 の改訂）
- **依存タスク:** タスク1
- **必要なテスト:** 各所でゲストが除外されること／**ゲストだけが参加希望している大会が督促の対象にならない**／会員のみの環境で総額・人数・督促が従来と1円1名も変わらないこと（回帰）／AC-23 は `/events` 一覧と大会詳細の人数が一致すること
- **完了条件:** 上記テストが green、`entry-fee-tally.test.ts` / `admin/entries/page.test.tsx` / 督促のテストが回帰しない
- **実装上の注意:**
  - E1・E2 は既に `users` を **inner join** しているので `ne(users.role, 'guest')` を足すだけ。
  - **E3 は現在 `event_attendances` を単独で数えている**。`users` への **inner join** を追加する（left join にすると `role` の NULL を考える羽目になる）。
  - **E4 は E3 とコードを共有していない独立実装**。`collectOverdueEntries` の相関サブクエリ（`select count(*) from event_attendances ea where ea.event_id = events.id and ea.attend = true`）に `users` を join して `role <> 'guest'` を足す。この式は SELECT と WHERE で使い回されているので、1箇所直せば「参加1名以上」の抽出条件と文面の「参加 N名」が同時に直る。エイリアス衝突を避けている既存コメント（`ea` を明示している理由）を壊さないこと。
  - **AC-23 は実装変更を伴わない**（`/events` 一覧の人数は元から素通しでゲストを含む）。テストで固定するだけ。
  - `docs/features/grade-entry-fee/requirements.md` の AC-9（「参加費集計と `page.tsx` の母集団が1文字も違わない」）を「**ゲスト除外を除いて同一**」へ改訂する。改訂しないと、この変更が既存要件への違反として読める。
- **対応Issue:** #486

### タスク7: ホーム（ゲストガード・タイムラインのゲスト印・確定名簿との合流）

- [ ] 完了
- **目的:** 会員が見るホームの出場タイムラインにゲストを印つきで載せる。確定名簿があるグループでもゲストが消えないようにする。
- **対応AC:** AC-9（Node 側ガード）, AC-21, AC-22
- **主な変更領域:** `apps/web/src/app/(app)/dashboard/**`（`page.tsx` / `HomeTimeline.tsx` / `home-timeline-types.ts` / `home-timeline-utils.ts`）
- **依存タスク:** タスク1
- **必要なテスト:** ゲストが `/dashboard` を開くと `/403`／希望パス（確定名簿なし）でゲストが印つきで載る／**確定名簿があるグループでも `attend=true` のゲストがチップに載り、会員側は名簿ベースのまま変わらない**（回帰）
- **完了条件:** 上記テストが green、`dashboard/page.test.tsx` の既存ケースが回帰しない
- **実装上の注意:** 確定パスは `tournament_entry_roster_entries`（`userId` 経由）から出場者を作っているので、**ゲストはそこに現れない**。ゲストぶんは `event_attendances.attend=true` から別に引いて合流させる（会員は名簿が正・ゲストは自己申告が正、という非対称を実装のコメントに残す）。クエリ本数が母集団の規模に依らず固定である既存の制約を壊さない（イベントごとに投げない）。
- **対応Issue:** #487

### タスク8: ロール変更の4択化

- [ ] 完了
- **目的:** 管理者が会員 ⇄ ゲストを切り替えられるようにする。
- **対応AC:** AC-25, AC-26, AC-37
- **主な変更領域:** `apps/web/src/app/(app)/admin/members/[id]/edit/**`（`member-role-section.tsx` / `actions.ts` / `actions.role.test.ts`）
- **依存タスク:** タスク1
- **必要なテスト:** 一般会員 → ゲスト・ゲスト → 一般会員の双方向が成功／**LINE 未紐付け・退会済みでも `guest` への変更は拒否されない**（昇格制限は `admin`/`vice_admin` にだけ効く）／`admin`・`vice_admin` への昇格制限が従来どおり効く（回帰）／有効な管理者が 0 人になる変更の拒否が従来どおり（回帰）／**ゲストの `unlinkLine` が拒否される**
- **完了条件:** 上記テストが green、`member-role-management` の既存 39 件が回帰しない
- **実装上の注意:**
  - 昇格制限（LINE 紐付け必須・退会済み不可）の判定は「変更先が `admin` または `vice_admin` のとき」に効くよう書かれているか確認し、`guest` が巻き込まれないようにする。
  - `unlinkLine` の `role='member'` 限定は**変えない**（ゲストは紐付けを解除できない＝未紐付けのゲスト行が発生しない。requirements §6）。
- **対応Issue:** #488

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1**（単独）— enum・型・招待種別列は全タスクの共有ホットスポット。ここだけ直列で先に通す。
- **Wave 2: タスク2, 3, 4, 5, 6, 7, 8**（7 並行）— いずれもタスク1にのみ依存し、変更領域が互いに重ならない。
  - タスク3（`admin/members/{page,actions}.ts`）とタスク8（`admin/members/[id]/edit/**`）は別ディレクトリで衝突しない
  - `/dashboard` を触るのはタスク7だけ（タスク2はページガードを `mail` / `players` / `tournaments` に限定する）
  - `events/[id]/**` を触るのはタスク5だけ
