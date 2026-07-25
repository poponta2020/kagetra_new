# イベント・出欠

> **責務:** 大会申込イベントの一覧・詳細・作成/編集・出欠回答・進行管理（申込/支払い状態のトグル）・過去イベントアーカイブの仕様
> **関連画面:** `/events`（大会申込一覧）、`/events/new`（新規作成・管理者専用）、`/events/[id]`（詳細・出欠回答）、`/events/[id]/edit`（編集・管理者専用）、`/events-archive`（過去のイベント）、`/dashboard`（ホーム）
> **主要実装:**
> - `apps/web/src/app/(app)/events/page.tsx`
> - `apps/web/src/app/(app)/events/EventListClient.tsx`
> - `apps/web/src/app/(app)/events/event-list-utils.ts`
> - `apps/web/src/app/(app)/events/new/page.tsx`
> - `apps/web/src/app/(app)/events/[id]/page.tsx`
> - `apps/web/src/app/(app)/events/[id]/actions.ts`
> - `apps/web/src/app/(app)/events/[id]/edit/page.tsx`
> - `apps/web/src/app/(app)/events-archive/page.tsx`
> - `apps/web/src/app/(app)/dashboard/page.tsx`
> - `apps/web/src/components/events/event-form.tsx`
> - `apps/web/src/components/events/EventLifecycleSection.tsx`（進行管理の管理者操作 UI。通知トリガーの詳細は [spec/notifications.md](notifications.md)）
> - `apps/web/src/components/events/LifecycleStatusBadge.tsx`（進行状態の読み取り専用ピル）
> - `apps/web/src/lib/event-status.ts`
> - `apps/web/src/lib/form-schemas.ts`（`eventFormSchema` / `extractEventFormData` / `extractEventUnitsFormData`）
> - `apps/web/src/lib/jst-date.ts`（JST 日付計算。締切判定・一覧分割で利用）

## 機能仕様

### イベントとは

`events` テーブル 1 行が「1 会場・1 日の大会開催単位」を表す。大会申込（他会主催の大会への参加募集を含む）を扱い、`kind` カラムで `individual`（個人戦）/ `team`（団体戦）を区別する。カラム定義の正典は docs/design/db.md。

複数日・複数級にまたがる同一大会は、`events` を日付/級ごとに複数行へ分割しつつ `editionId`（`tournament_series_editions` への参照）で束ねる。edition（開催）・series（大会シリーズ）自体の名寄せ・解決ロジックは `apps/web/src/lib/edition/resolve.ts` が持ち、詳細は [spec/tournaments-results.md](tournaments-results.md) を参照。手動作成/編集フォーム（`EventForm`）にも「開催に紐付ける」チェックボックスがあり、系列名＋回次を入力すると `resolveEditionFromForm` が既存 edition を解決するか新規作成する。

### 一覧と過去イベントの分割

`/events`（大会申込一覧）と `/events-archive`（過去のイベント）は同じ `events` テーブルを JST 基準の `event_date`（`YYYY-MM-DD` 文字列の辞書式比較）で振り分ける。`todayInJst()`（`jst-date.ts`）相当の JST 今日文字列を各ページが個別に算出し、`/events` は `eventDate >= todayStr`、`/events-archive` は `eventDate < todayStr` を条件にクエリする。加えて `/events` のみ `entryStatus != 'not_applying'` を AND する — 「申込者がいないため申し込まない」は会内締切後にしか下せない終端判断で、押した後にその大会へ行う操作が存在しないため、一覧に残すと期限切れの大会が積み上がる。除外は取得後フィルタではなくクエリ条件で行い、件数表示・並び替え・フィルタの母集団を揃える。`/events-archive` はこの除外を持たないので、開催日を過ぎれば `not_applying` の大会も従来どおり並ぶ。結果として `not_applying` の大会は開催日が来るまでどちらの一覧にも現れず、詳細 URL の直叩きだけが到達手段になる（意図的な設計。復帰導線は詳細ページに常に残る）。両ページとも参加者集計（`event_attendances` の `attend=true` 件数）を表示中の event id 集合にスコープして取得し、もう一方の画面のみに表示される行をスキャンしない。

### 一覧の表示・並び替え・フィルタ

`/events` はサーバー（`page.tsx`）が最小データ（`EventListItem`: id / title / eventDate / internalDeadline / status / canApply / attendCount / chipSurnames）に畳んでクライアント（`EventListClient`）へ渡す。並び替え軸は「開催日順」「締切日順」の 2 種（既定は締切日順、`sortEvents`）。「申込可能のみ」トグルは `canApply`（サーバーで `isGradeEligible(eligibleGrades, myGrade)` により算出済み。管理者バイパスなし、`grade=null` は対象級ありの大会で不可）でクライアント側フィルタする。ソート/フィルタ状態は画面内のみで永続化しない。

締切カウントダウン（`formatDeadlineCountdown`）は `internalDeadline − todayStr` の日数差で 5 段階に分類する: `null` → `—`（none）、負 → 「締切済」（past）、`0` → 「本日」（today、強調）、`1〜3` → 「あとN日」（soon、強調。しきい値は `SOON_THRESHOLD=3`）、それ以上 → 「あとN日」（normal）。参加者チップは `attendCount` のうち先頭 `CHIP_LIMIT=5` 名の姓（`surname()`）を級昇順で表示し、残りは「他N名」に畳む。

過去イベント一覧（`/events-archive`）は並び替え/フィルタ UI を持たず、開催日降順の単純なカードリストで、タイトル・公認バッジ（`official`）・開催日・会場（設定時）・ステータスピル・参加人数（`attend=true` の集計）を表示する。

### イベントのステータスとライフサイクル状態

`events.status`（`published` / `cancelled` / `done`）はイベント自体の開催状態。draft は廃止済みで、作成経路は必ず `published` から始まる。`eventStatus()`（`event-status.ts`）は `cancelled` → 「中止」（danger）、`done` → 「終了」（info）のピルを返し、`published` を含むそれ以外はピル非表示（`null`）を返す — 通常運転中の大会にステータス行を出さない設計。

`entryStatus`（`not_applied` / `applied` / `not_applying`）、`paymentType`（`advance` / `onsite` / `null`）、`paymentStatus`（`unpaid` / `paid`）は「会として主催者に対して行う 1 アクション」の進行状態で、会員個々の出欠とは独立している。これらのトグルと、初回遷移時の LINE 完了通知トリガーは `apps/web/src/app/(app)/events/[id]/actions.ts` の `setEntryApplied` / `setEntryNotApplying` / `setPaymentType` / `setPaymentPaid` が持つが、実際の通知組み立て・送信（`buildLifecycleMessage` / `claimLifecycleNotification` / `sendClaimedNotification`、`apps/web/src/lib/event-lifecycle-notify.ts`）は [spec/notifications.md](notifications.md) の管轄。`LifecycleStatusBadge` は誰でも見える読み取り専用ピル（`not_applied`=neutral「未申込」／`applied`=success「申込済」／`not_applying`=info「申込なし」。`not_applying` のときは支払いピルを描画しない — 申し込まない大会に支払い状態は無意味なため）、`EventLifecycleSection` は管理者専用の操作パネルで、`isAdmin` により `/events/[id]` で出し分けている。

`not_applying`（申込なし）は「申込者がいないため、会として今回は主催者へ申し込まない」という終端判断を記録する状態。設定・解除で LINE 通知は一切送らない（対外アクションを伴わない内部判断のため）。遷移は `not_applied → not_applying` と `applied → not_applying`（取り下げ。想定は低いが状態機械として塞がない）、および解除の `not_applying → not_applied` の3方向で、**`not_applying → applied` の直接遷移は UI に用意しない** — 復帰は必ず `not_applied` を経由させ、`setEntryApplied` の遷移ガード `WHERE entry_status = 'not_applied'` を変更せずに済ませる（2ステップ目は既存経路そのものなので、申込完了通知2通と once-ever は既存挙動のまま）。出欠回答の可否は `not_applying` でも変わらない（従来どおり会内締切・対象級・`isInvited` で判定する）。

### 出欠登録ルール

ドメインルール「未回答 = 不参加」: `event_attendances` に行がない会員は出欠状況の集計上「不参加」として扱われる（明示的な `attend=false` の行があるわけではない）。`/events/[id]` の出欠状況カードは「対象会員（`eligibleUsers`）」を分母に、`参加人数 = attend=true`件、`不参加+未回答人数 = 分母 - 参加人数` として常に一致するよう算出する。

出欠回答が可能（`canRespond`）な条件は、ログイン済みかつ次のいずれか:
- 管理者・副管理者（`isAdmin`）: 締切・級・招待有無を無視して常に回答可能
- 一般会員: `users.isInvited=true` かつ 会内締切（`internalDeadline`）当日以前（JST）かつ 対象級（`eligibleGrades`）に自分の級が含まれる（`eligibleGrades` 未設定なら全級対象）

`isInvited` の再チェックは、Auth.js の signIn が既に紐付いたアカウントの再ログインを `isInvited` ゲート無しで許容するため、画面側で必ず DB から再取得して確認している。級未設定（`grade=null`）の会員は対象級ありの大会には回答不可（自己サービスでの級設定 UI は無く、管理者に設定を依頼する）。

`submitAttendance` サーバーアクションはこれらのガードをサーバー側でも再検証し（管理者はバイパス）、`event_attendances`（`eventId, userId` の UNIQUE）へ `onConflictDoUpdate` で upsert する。出欠のトグル（参加する/参加をキャンセル）ボタンは `attend` のみを送信し、コメント欄（`<details>` で折り畳み）は別フォームで明示的に送信したときだけ `comment` を更新する — トグル操作で既存コメントを消さないための分離。

### 対象者・対象級の絞り込み

`eligibleGrades`（`Grade[] | null`）が設定されている大会は、その級の会員のみが「対象」になる。分母となる `eligibleUsers` は `users.isInvited=true` かつ（`eligibleGrades` があれば）`grade IN eligibleGrades` で絞り込む。招待未確定・退会等で `isInvited=false` になった旧データ行は分母・参加者一覧のどちらからも除外される。

### 定員

`capacity`（総定員）と `capacityA`〜`capacityE`（級別定員）は `/events/[id]` 詳細・編集フォームに保持・表示されるが、確認できた範囲では出欠登録時に定員超過を拒否する処理は無い（表示専用の参考情報）。

### ホーム画面（ダッシュボード）

`/dashboard` はプロフィール（ロール表示）のみを表示し、イベント一覧やカウントダウン等の実データは表示していない。

## 画面

### `/events` 大会申込一覧

未来日（JST 今日以降）かつ `entryStatus != 'not_applying'` のイベントを開催日昇順で取得し、`EventListClient` に渡す。ヘッダーに「過去のイベント →」（`/events-archive`）リンクと、管理者のみ「新規作成」（`/events/new`）ボタンを表示する。0 件時は並び替え UI を出さず「現在のイベントはありません」を表示、フィルタ適用で 0 件になった場合は「申込可能な大会はありません」を表示する。

各行はイベント詳細（`/events/[id]`）へのリンクで、日付・タイトル・ステータスピル・締切カウントダウン・参加人数と参加者チップを表示する。

### `/events/new` 新規作成

管理者・副管理者のみアクセス可（それ以外は `/403` へリダイレクト）。`EventForm`（`mode="create"`）を描画し、送信時は `eventFormSchema` でバリデーション後、`resolveEditionFromForm` による edition 紐付けと `events` への insert を 1 トランザクションで行い、作成後は詳細画面へリダイレクトする。作成経路は常に `status='published'` 固定（フォームに status 入力欄自体を出さない）。

### `/events/[id]` 詳細

イベント基本情報（`DescList`）、説明、出欠状況カード、進行管理（管理者は `EventLifecycleSection`、一般会員は `LifecycleStatusBadge` のみ）、LINE 配信セクション（[spec/notifications.md](notifications.md)）、名簿セクション（`RosterSection`。個人戦のみ・[spec/tournaments-results.md](tournaments-results.md)）、関連メール（管理者のみ・[spec/mail-worker.md](mail-worker.md)）、参加者一覧、出欠回答フォーム（コメント欄＋ sticky なトグルボタン）を上から順に描画する。管理者のみ右上に「編集」リンクを表示する。

出欠回答不可の会員には理由（対象外／会内締切超過／級未設定／対象外の級）をカードで示す。

### `/events/[id]/edit` 編集

管理者・副管理者のみ。既存イベントを `EventForm`（`mode="edit"`）に事前入力し、edition 紐付けの現況（`editionDefault`）も渡す。`mode="edit"` のときのみステータス選択（公開(通常)/中止/終了）を表示し、中止からの復帰は「公開(通常)」を選ぶ。更新後は詳細画面へリダイレクトする。

### `/events-archive` 過去のイベント

過去日（JST 今日より前）のイベントを開催日降順のカードリストで表示。並び替え/フィルタは無く、タイトル・公認バッジ・開催日・会場（設定時）・ステータスピル・参加人数を示す簡易ビュー。

## フロー

### 出欠回答フロー

1. 会員が `/events/[id]` を開く（未ログインは回答不可）
2. サーバーが `isAdmin` / `isInvited` / `internalDeadline` / `eligibleGrades` から `canRespond` を算出し、回答可否と UI 出し分けを決める
3. 回答可能なら sticky ボタンで参加/キャンセルをトグル（`attend` のみ送信）、または折り畳みのコメント欄から `comment` のみ送信
4. `submitAttendance` がサーバー側でも同じガードを再検証し、`event_attendances` を upsert
5. `revalidatePath` でイベント詳細を再検証

### イベント作成・編集フロー

1. 管理者が `/events/new` または `/events/[id]/edit` でフォームへ入力（タイトル・日付・場所・定員・締切各種・対象級・参加費・支払関連・主催・申込方法・説明・開催紐付け）
2. サーバーアクションが `eventFormSchema`（`form-schemas.ts`）でバリデーション
3. `resolveEditionFromForm` で開催（edition）の紐付けを解決（詳細は [spec/tournaments-results.md](tournaments-results.md)）
4. `events` テーブルへ insert/update し、詳細画面へリダイレクト

`EventForm` は「大会案内 AI 抽出→承認」画面（`extractEventUnitsFormData` 経由。詳細は [spec/mail-worker.md](mail-worker.md)）からも `fieldPrefix` 付きの埋め込みモードで再利用される。埋め込みモードでは抽選日・開催紐付け・カード/フォーム外枠を描画しない（親コンポーネントが複数ユニット分をまとめて 1 つの `<form>` に束ねるため）。

### 進行管理（申込/支払い状態）フロー

1. 管理者が `/events/[id]` の「進行管理」パネルで「申込済にする」等をクリック。申込状態行のボタン構成は状態で変わる: `not_applied` → 「申込済にする」＋「申し込まない」、`applied` → 「未申込に戻す」＋「申し込まない」、`not_applying` → 「未申込に戻す」のみ
2. LINE グループが紐付き済み（`isLineLinked`）かつ通知を伴う操作（申込済化・支払済化。取り消し方向や支払いタイプ変更は通知なし）なら、クライアントで `window.confirm` による確認を挟む。「申し込まない」は LINE 通知を伴わないが `/events` 一覧から消える不可視化を伴うため、`isLineLinked` に関係なく別文言の確認を必ず出す（解除側は確認なし）
3. `setEntryApplied` / `setPaymentPaid` が対象トランザクション内で状態を `not_applied → applied` 等の初回遷移でのみ更新し、同一トランザクションで通知 claim（`claimLifecycleNotification`）を行う。再トグルや二重呼び出しでは 2 回目以降は通知されない（once-ever）
4. コミット後、push 送信は best-effort（失敗しても状態変更はロールバックしない）
5. `revalidatePath` でイベント詳細を再検証

支払いタイプを `advance` から離れる方向へ変更すると、`paymentStatus`/`paymentPaidAt` は自動的に未払へ戻す（ただし once-ever 通知 claim ログ自体は削除しない＝再度支払済にしても完了通知は再送されない）。

## API（Server Actions）

### `submitAttendance(eventId, formData)` — `events/[id]/actions.ts`

ログイン必須。管理者以外は `isInvited` / 会内締切 / 対象級を再検証してからエラーを投げる（クライアント側の `canRespond` 判定をサーバーでも信頼しない）。`attend` は常に更新、`comment` は `formData` に `comment` キーが存在するときのみ更新する（トグル送信では省略されるため既存コメントを保持）。`event_attendances(eventId, userId)` の UNIQUE を使った upsert。

### `createEvent(formData)` / `updateEvent(formData)` — `events/new/page.tsx` / `events/[id]/edit/page.tsx` 内の inline server action

管理者・副管理者ガード（`session.user.role`）。`eventFormSchema.safeParse(extractEventFormData(formData))` でバリデーションし、失敗時は最初のエラーメッセージを添えて例外を投げる。対象級チェックボックス（`grade_A`〜`grade_E`）はスキーマ外で個別に読み取り、`eligibleGrades` 配列に組み立てる。`resolveEditionFromForm` による edition 解決と `events` insert/update を 1 トランザクションで行う。

### `setEntryApplied(eventId, applied)` / `setEntryNotApplying(eventId)` / `setPaymentType(eventId, type)` / `setPaymentPaid(eventId, paid)` — `events/[id]/actions.ts`

いずれも管理者・副管理者専用（`requireAdminSession()`）。`entryStatus` / `paymentType` / `paymentStatus` の更新自体はこのドメインの管轄だが、初回遷移で発火する LINE 通知の組み立て・送信ロジックは [spec/notifications.md](notifications.md) が正典。`cancelled` ステータスの大会には通知しない（状態変更自体は記録する）。

`setEntryNotApplying` は `entryStatus='not_applying'`・`entryAppliedAt=null` へ無条件 UPDATE し、通知 claim も push も行わない。`entryStatus` が `/events` 一覧の表示可否を左右するため、詳細ページに加えて `/events` も `revalidatePath` する（`setEntryApplied` の解除分岐も同様）。

## 既知のギャップ・未確認事項

- 定員（`capacity` / `capacityA`〜`capacityE`）は表示専用に見え、出欠登録時に定員超過を拒否する実装はコード上確認できなかった。将来的な制限予定かどうかは未確認。
- `events.kind='team'`（団体戦）を実際に選択・作成できる UI 経路は `EventForm` 内で確認できなかった（フォームは `kind` を常に `individual` 固定の hidden input で送信している）。団体戦イベントがどの経路で作られるかは未確認。
