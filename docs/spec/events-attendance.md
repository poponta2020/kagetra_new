# イベント・出欠

> **責務:** 大会申込イベントの一覧・詳細・作成/編集・出欠回答・進行管理（申込/支払い状態のトグル）・申込進捗ボード・過去イベントアーカイブの仕様
> **関連画面:** `/events`（大会申込一覧）、`/events/new`（新規作成・管理者専用）、`/events/[id]`（詳細・出欠回答）、`/events/[id]/edit`（編集・管理者専用）、`/admin/entries`（申込管理ボード・閲覧は全員）、`/events-archive`（過去のイベント）、`/dashboard`（ホーム）
> **主要実装:**
> - `apps/web/src/app/(app)/events/page.tsx`
> - `apps/web/src/app/(app)/admin/entries/page.tsx`
> - `apps/web/src/app/(app)/admin/entries/EntryBoardClient.tsx`
> - `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts`
> - `apps/web/src/app/(app)/events/EventListClient.tsx`
> - `apps/web/src/app/(app)/events/event-list-utils.ts`
> - `apps/web/src/app/(app)/events/new/page.tsx`
> - `apps/web/src/app/(app)/events/[id]/page.tsx`
> - `apps/web/src/app/(app)/events/[id]/actions.ts`
> - `apps/web/src/app/(app)/events/[id]/edit/page.tsx`
> - `apps/web/src/app/(app)/events-archive/page.tsx`
> - `apps/web/src/app/(app)/dashboard/page.tsx`
> - `apps/web/src/app/(app)/dashboard/HomeTimeline.tsx`（ホーム「会の出場予定」の描画）
> - `apps/web/src/app/(app)/dashboard/home-timeline-types.ts` / `home-timeline-utils.ts`
> - `apps/web/src/components/events/event-form.tsx`
> - `apps/web/src/components/events/EventLifecycleSection.tsx`（進行管理の管理者操作 UI。通知トリガーの詳細は [spec/notifications.md](notifications.md)）
> - `apps/web/src/components/events/LifecycleStatusBadge.tsx`（進行状態の読み取り専用ピル）
> - `apps/web/src/lib/event-status.ts`
> - `apps/web/src/lib/form-schemas.ts`（`eventFormSchema` / `extractEventFormData` / `extractEventUnitsFormData`）
> - `apps/web/src/lib/jst-date.ts`（JST 日付計算。締切判定・一覧分割で利用）
> - `apps/web/src/app/(app)/admin/entry-form/[groupId]/`（申込書作成プレビュー S2・Server Actions）
> - `apps/web/src/app/(app)/settings/entry-form/`（申込書設定 S3）
> - `apps/web/src/lib/entry-form/`（セルマップ推定・xlsx 記入・メール定型・MIME・IMAP APPEND・会定数）
> - `apps/web/src/app/api/admin/entry-form/drafts/[id]/route.ts`（生成 xlsx のダウンロード）

## 機能仕様

### 申込グループ（entry_groups）

大会は開催日ごとに別 `events` 行として登録されるが（多摩A=8/15、多摩B=8/11…）、実運用の申込・締切・
名簿・抽選・LINE 連絡は「**同じ案内メール × 同じ申込締切**」のまとまり単位で行われる。この単位を
表すのが `entry_groups` で、`events.entry_group_id` は **NOT NULL**（単独イベントもシングルトン
グループを持つので「グループあり/なし」の分岐がコードに現れない）。

- **既定の生成規則**（制約ではない。管理者は後から自由に付け替えられる）: `tournament_draft_id` が
  同じ AND `entry_deadline` が一致（**NULL 同士も一致**）→ 同一グループ。draft 無し（手動作成・
  移行データ）はシングルトン。規則の正典は純関数 `clusterEventsByEntryGroup`
  （`apps/web/src/lib/entry-group-cluster.ts`。DB 非依存の leaf なので client からも使える）で、
  backfill migration と承認フォームの自動提案が同じ関数を共有する
- **表示名は保存しない**（`deriveEntryGroupName`）。グループ内タイトルの共通接頭辞＋級文字を結合
  （多摩A+多摩B→「多摩AB」）、全同一ならそのまま（大学生選手権×3）、導出できないときは代表
  イベントのタイトル。日が増減しても名前が stale にならない
- **代表イベント**（`selectRepresentativeEvent`）= 今日以降で最も開催日が近いもの、無ければ開催日が
  最新のもの。`cancelled` も候補に含める（詳細画面には到達できるため）
- **進行状態（`entryStatus` / `paymentType` / `paymentStatus`）は日別のまま**。「C級の日だけ申し込む」
  が本番で実在するため。一括化したのは**操作**だけで、状態は日ごとに持つ
- **グループ専用の画面がある**: `/admin/entries/[groupId]`（下記「申込グループページ」）。管理者の
  申込運用（進行管理・共通締切の編集・LINE配信・申込書・関連メール）はすべてそこに集約され、
  `/events/[id]`（日ページ）は会員が「その日に出るか」を答える画面に純化されている
- グループ帰属になったもの: LINE 紐付け・配信（[spec/notifications.md](notifications.md)）と
  名簿（[spec/tournaments-results.md](tournaments-results.md)）。締切カラムは events に残すが、
  **編集の入口はグループページの「共通項目」1箇所**で、保存はグループ全日（`cancelled` 含む）へ
  同一トランザクションで書く（伝播という概念は無くなった）
- **手動フラグ `confirmed_roster_override`**（confirmed-roster-signal）: 「確定名簿ありとして扱う」を
  管理者が立てるための boolean 1 列。`entry_groups` は原則として列を持たない設計だが、確定名簿の
  判定材料はすべてグループスコープで、`events` に置くと「グループ内のどの日から見ても同じ結果になる」
  という不変条件が壊れるためここに置く。誰がいつ立てたかは記録しない（[判定の定義](#adminentries-申込管理ボード)）
- 空グループは条件付きで自動削除（`deleteGroupIfEmpty`。events / event_line_broadcasts /
  tournament_entry_rosters / line_channels.assigned_entry_group_id が**全て0件のときだけ**。
  削除条件はこの関数に集約されている）。LINE 紐付けや名簿は付け替え時に移動元グループへ
  残る仕様なので、それらを持つグループはイベント0件でも残る（FK は RESTRICT のため、
  削除を試みると付け替えトランザクション自体がロールバックする）。残ったグループの Bot は
  日次の自動解放バッチが回収する（[spec/notifications.md](notifications.md)）

### イベントとは

`events` テーブル 1 行が「1 会場・1 日の大会開催単位」を表す。大会申込（他会主催の大会への参加募集を含む）を扱い、`kind` カラムで `individual`（個人戦）/ `team`（団体戦）を区別する。カラム定義の正典は docs/design/db.md。

複数日・複数級にまたがる同一大会は、`events` を日付/級ごとに複数行へ分割しつつ `editionId`（`tournament_series_editions` への参照）で束ねる。edition（開催）・series（大会シリーズ）自体の名寄せ・解決ロジックは `apps/web/src/lib/edition/resolve.ts` が持ち、詳細は [spec/tournaments-results.md](tournaments-results.md) を参照。手動作成/編集フォーム（`EventForm`）にも「開催に紐付ける」チェックボックスがあり、系列名＋回次を入力すると `resolveEditionFromForm` が既存 edition を解決するか新規作成する。

### 一覧と過去イベントの分割

`/events`（大会申込一覧）と `/events-archive`（過去のイベント）は同じ `events` テーブルを JST 基準の `event_date`（`YYYY-MM-DD` 文字列の辞書式比較）で振り分ける。`todayInJst()`（`jst-date.ts`）相当の JST 今日文字列を各ページが個別に算出し、`/events` は `eventDate >= todayStr`、`/events-archive` は `eventDate < todayStr` を条件にクエリする。加えて `/events` のみ `entryStatus != 'not_applying'` を AND する — 「申込者がいないため申し込まない」は会内締切後にしか下せない終端判断で、押した後にその大会へ行う操作が存在しないため、一覧に残すと期限切れの大会が積み上がる。除外は取得後フィルタではなくクエリ条件で行い、件数表示・並び替え・フィルタの母集団を揃える。`/events-archive` はこの除外を持たないので、開催日を過ぎれば `not_applying` の大会も従来どおり並ぶ。結果として `not_applying` の大会は開催日が来るまでどちらの一覧にも現れず、詳細 URL の直叩きだけが到達手段になる（意図的な設計。復帰導線は詳細ページに常に残る）。両ページとも参加者集計（`event_attendances` の `attend=true` 件数）を表示中の event id 集合にスコープして取得し、もう一方の画面のみに表示される行をスキャンしない。

### 一覧の表示・並び替え・フィルタ

`/events` はサーバー（`page.tsx`）が最小データ（`EventListItem`: id / title / eventDate / internalDeadline / status / canApply / attendCount / attendeeSurnames / viewerAttending）に畳んでクライアント（`EventListClient`）へ渡す。`attendeeSurnames` は `attend=true` 参加者**全員**の姓（`surname()`）を級昇順（未設定は末尾）で並べたもの、`viewerAttending` は閲覧者自身が `attend=true` かどうか。`viewerAttending` は参加者取得の 1 クエリに `event_attendances.user_id` を足して判定し、追加クエリを発生させない（クライアントへ渡すのは苗字のみで、`user_id` は境界を越えない）。

クライアントは **可視判定 → 「申込可能のみ」フィルタ → ソート** の順に適用する。可視判定（`isRowVisible`）は会内締切を過ぎた行（`isPastDeadline`＝`formatDeadlineCountdown` の `past` tone を単一の真実として判定）を一覧から外すが、**閲覧者自身が `attend=true` の行だけは残す** — 締切後に「自分が申し込んだか」を確認する導線を一覧に維持するため。締切当日（`daysLeft=0`）と締切未設定（`null`）は `past` ではないので表示される。この除外をサーバーの母集団条件にしないのは、自分の出欠状態で行集合がユーザーごとに変わるため（件数・ソートの母集団は可視判定後で揃える）。空表示の母集団も可視判定後で、可視 0 件なら「現在のイベントはありません」（コントロール非表示）、「申込可能のみ」で 0 件になったときだけ「申込可能な大会はありません」を出す。並び替え軸は「開催日順」「締切日順」の 2 種（既定は締切日順、`sortEvents`）。「申込可能のみ」トグルは `canApply`（サーバーで `isGradeEligible(eligibleGrades, myGrade)` により算出済み。管理者バイパスなし、`grade=null` は対象級ありの大会で不可）でクライアント側フィルタする。ソート/フィルタ状態は画面内のみで永続化しない。

締切カウントダウン（`formatDeadlineCountdown`）は `internalDeadline − todayStr` の日数差で 5 段階に分類する: `null` → `—`（none）、負 → 「締切済」（past）、`0` → 「本日」（today、強調）、`1〜3` → 「あとN日」（soon、強調。しきい値は `SOON_THRESHOLD=3`）、それ以上 → 「あとN日」（normal）。表示は日数の**数字だけ**を周囲の「あと」「日」より大きく描画し（normal 15px / soon 19px）、soon は色を落とさず墨のまま、朱（accent）の塗りピルは **today だけ**に使う（朱＝本当に急ぐ行、というシグナルを薄めないため）。

各行の左端には 3px の縦帯があり、`isOpenForEntry`（`canApply && 中止でない && 締切超過でない`＝「今この行から申し込める」）が真なら藍（brand）、それ以外は砂（border）。`canApply` 自体の判定（級のみ）は変えず、中止と締切超過を帯の表示側で重ねている。参加者は `attendCount ≥ 1` の行だけ meta 行を描画し（0 名の行は行ごと出さない）、人数を藍で大きく、苗字を「・」区切りで全員表示する（上限・「他N名」の畳み込みは廃止）。ページ余白 16px は `/events` の `page.tsx` 側で持ち、共通シェル（`mobile-shell.tsx` の `<main>`）には入れない — 自前で `p-4` を持つ既存ページが二重余白になるため。

過去イベント一覧（`/events-archive`）は並び替え/フィルタ UI を持たず、開催日降順の単純なカードリストで、タイトル・公認バッジ（`official`）・開催日・会場（設定時）・ステータスピル・参加人数（`attend=true` の集計）を表示する。

### イベントのステータスとライフサイクル状態

`events.status`（`published` / `cancelled` / `done`）はイベント自体の開催状態。draft は廃止済みで、作成経路は必ず `published` から始まる。`eventStatus()`（`event-status.ts`）は `cancelled` → 「中止」（danger）、`done` → 「終了」（info）のピルを返し、`published` を含むそれ以外はピル非表示（`null`）を返す — 通常運転中の大会にステータス行を出さない設計。

`entryStatus`（`not_applied` / `applied` / `not_applying`）、`paymentType`（`advance` / `onsite` / `null`）、`paymentStatus`（`unpaid` / `paid`）は「会として主催者に対して行う 1 アクション」の進行状態で、会員個々の出欠とは独立している。これらのトグルと、初回遷移時の LINE 完了通知トリガーは `apps/web/src/app/(app)/events/[id]/actions.ts` の `setEntryApplied` / `setEntryNotApplying` / `setPaymentType` / `setPaymentPaid` が持つが、実際の通知組み立て・送信（`buildLifecycleMessage` / `claimLifecycleNotification` / `sendClaimedNotification`、`apps/web/src/lib/event-lifecycle-notify.ts`）は [spec/notifications.md](notifications.md) の管轄。`EventLifecycleSection` は管理者専用の操作パネル（「申込状態」「支払状態」の2トグル）で、`isAdmin` のときだけ `/events/[id]` に描画される。一般会員向けの読み取り専用ピルは廃止した — 進行段階は両ビュー共通の「申込フロー」が表す。`LifecycleStatusBadge` はこの画面では使わなくなったが、進行状態3型（`EntryStatus` / `PaymentStatus` / `PaymentType`）の**型の正典**として残っており `/admin/entries` の `entry-board-utils.ts` が import している。

`not_applying`（申込なし）は「申込者がいないため、会として今回は主催者へ申し込まない」という終端判断を記録する状態。設定・解除で LINE 通知は一切送らない（対外アクションを伴わない内部判断のため）。遷移は `not_applied → not_applying` と `applied → not_applying`（取り下げ。想定は低いが状態機械として塞がない）、および解除の `not_applying → not_applied` の3方向で、**`not_applying → applied` の直接遷移は UI に用意しない** — 復帰は必ず `not_applied` を経由させ、`setEntryApplied` の遷移ガード `WHERE entry_status = 'not_applied'` を変更せずに済ませる（2ステップ目は既存経路そのものなので、申込完了通知2通と once-ever は既存挙動のまま）。出欠回答の可否は `not_applying` でも変わらない（従来どおり会内締切・対象級・`isInvited` で判定する）。

### 出欠登録ルール

ドメインルール「未回答 = 不参加」: `event_attendances` に行がない会員は出欠状況の集計上「不参加」として扱われる（明示的な `attend=false` の行があるわけではない）。`/events/[id]` は参加人数（`attend=true` かつ現在の対象級）だけを「参加者」セクションの見出しに出す。不参加人数の算出・表示は廃止した（分母を示す出欠状況カード自体を廃止したため）。`eligibleUsers`（対象会員）のクエリは残っており、参加者一覧から対象級外の stale な `attend=true` 行を除外する役割を担う。

出欠回答が可能（`canRespond`）な条件は、ログイン済みかつ次のいずれか:
- 管理者・副管理者（`isAdmin`）: 締切・級・招待有無を無視して常に回答可能
- 一般会員: `users.isInvited=true` かつ 会内締切（`internalDeadline`）当日以前（JST）かつ 対象級（`eligibleGrades`）に自分の級が含まれる（`eligibleGrades` 未設定なら全級対象）

`isInvited` の再チェックは、Auth.js の signIn が既に紐付いたアカウントの再ログインを `isInvited` ゲート無しで許容するため、画面側で必ず DB から再取得して確認している。級未設定（`grade=null`）の会員は対象級ありの大会には回答不可（自己サービスでの級設定 UI は無く、管理者に設定を依頼する）。

`submitAttendance` サーバーアクションはこれらのガードをサーバー側でも再検証し（管理者はバイパス）、`event_attendances`（`eventId, userId` の UNIQUE）へ `onConflictDoUpdate` で upsert する。出欠のトグル（参加する/参加をキャンセル）ボタンは `attend` のみを送信する。`comment` は `formData` に当該キーがあるときだけ更新されるため、トグル操作で既存コメントは消えない。**出欠コメントの入力 UI は `/events/[id]` から廃止した**（`event_attendances.comment` のデータと `submitAttendance` の comment 更新経路は残っているが、この画面から呼ぶフォームは無い）。

### 対象者・対象級の絞り込み

`eligibleGrades`（`Grade[] | null`）が設定されている大会は、その級の会員のみが「対象」になる。分母となる `eligibleUsers` は `users.isInvited=true` かつ（`eligibleGrades` があれば）`grade IN eligibleGrades` で絞り込む。招待未確定・退会等で `isInvited=false` になった旧データ行は分母・参加者一覧のどちらからも除外される。

### 定員

`capacityA`〜`capacityE`（級別定員）は `/events/[id]` 詳細の「級別定員」セクションに表示する。同セクションは旧「対象級」行を吸収しており、3分岐する: 定員が1つ以上あれば級＋定員数（＋合計）／定員が全て未設定なら `eligibleGrades` の級だけを数字なしで並べる／`eligibleGrades` も定員も無ければセクションごと非表示。`capacity`（総定員）は編集フォームにのみ保持し、詳細では表示しない。確認できた範囲では出欠登録時に定員超過を拒否する処理は無い（表示専用の参考情報）。

### ホーム画面（ダッシュボード）

`/dashboard` は「会の出場予定」——この先どの大会に誰が出るのかを一覧する画面。縦順は **未回答アラート → 今日の大会カード → 出場タイムライン**で、該当が無いブロックは枠ごと消える。`/events` が「申込の締切管理」なのに対し、ホームは「会の顔ぶれ」で、同じ母集団を別のレンズで見る（あいさつ・権限カードは廃止）。ログイン必須（`session.user.id` が無ければ `/403`）。

**母集団**は `/admin/entries` と同じ（`eventDate >= todayInJst()` ∧ `status != 'cancelled'` ∧ `kind = 'individual'`）。表示名は `entry-board-utils.displayName`（通称 + 対象級。edition 未紐付けは `title`）。**出場者が 0 名の大会はタイムラインに載せない**。今日開催は今日カード（会場つき）、それ以降は開催日昇順のタイムライン（初期 4 件 + 「もっと見る」で同一画面展開）。

**出場者リストの確度**は 2 系統ある。`tournament_entry_rosters` に `rosterType='confirmed'` ∧ `supersededAt IS NULL` の版がある**申込グループ**は「確定」で、その `tournament_entry_roster_entries` のうち `status IN ('confirmed','carried_up')` ∧ `selectionOutcome NOT IN ('waitlisted','rejected')` ∧ `userId IS NOT NULL` が出場者になる。確定名簿が無いグループは「希望」で、`event_attendances.attend = true` ∧ 対象者（上記「対象者・対象級の絞り込み」と同じ `isInvited` ＋ 級の条件）へフォールバックする。**対象級による絞り込みは希望パスにのみ掛ける** —— 名簿はその大会の出場者の唯一の権威であり、現在の `users.grade` で絞ると昇級者が名簿から消えるため。名簿は event ではなく `entryGroupId` に属するので、同じグループの各日は同じ出場者リストを共有する。

**出場者チップの級**は、確定パスが `tournament_entry_roster_entries.grade`（＝その大会で出る級。null のときだけ `users.grade`）、希望パスが `users.grade`。級はシーズン途中で上がるため、`users.grade` で統一すると対象級外の級がチップに出る。

**未回答アラート**は、自分の級が対象（`eligibleGrades` が空/null なら全員が対象）で、基準締切 `COALESCE(internalDeadline, entryDeadline)` が今日から 7 日以内（締切当日を含み、超過は出さない）、かつ自分の `event_attendances` 行が**無い**大会を基準締切の早い順に並べる。`attend` の値は問わない（「不参加」と回答済みなら出さない）。母集団は上記そのもので、出場者 0 名の大会も対象にする。締切超過分の督促は管理者への LINE 通知（[notifications.md](notifications.md) の entry-overdue-alert）が担う。

クエリ本数は母集団の規模に依らず固定（イベントごとには投げない）。`todayStr` はサーバーが `todayInJst()` で渡し、クライアントでは `Date.now()` を呼ばない（hydration mismatch 回避）。

## 画面

### `/events` 大会申込一覧

未来日（JST 今日以降）かつ `entryStatus != 'not_applying'` のイベントを開催日昇順で取得し、`EventListClient` に渡す。**ページ見出し行（h1「大会申込」）は持たない** — 「過去のイベント →」（`/events-archive`）リンクと、管理者のみ「新規作成」（`/events/new`）ボタンは**リスト末尾のフッター行**（左右振り分け）に置く。フッターはクライアントではなくページ側にあるため、並び替え・フィルタの状態にも 0 件表示にも左右されず常に出る（見出し行が無い以上、ここが唯一のアーカイブ導線になるため）。0 件時は並び替え UI を出さず「現在のイベントはありません」を表示、フィルタ適用で 0 件になった場合は「申込可能な大会はありません」を表示する。

並び替えは開催日順（**既定**）と締切日順の 2 ビューで、**行の形が異なる**。既定を開催日順にしているのは「次にどの大会があるか」を暦の並びで見るのが主用途で、締切日順は申込作業をするときに切り替える副ビューだから。

- **締切日順**: 区切り線で並ぶフラットなリスト。各行はイベント詳細（`/events/[id]`）へのリンクで、タイトル・開催日（`9/6(日)`）・ステータスピル・締切カウントダウン・参加人数と参加者を表示する。開催月と締切月が食い違うため月区切りはしない。
- **開催日順**: 行を**開催月ごとのセクション**に束ね、月見出し（ゼロ埋め 2 桁の月数字＋英字月名＋藍の太罫）を挿入する。件数表記は出さない。西暦は**年が変わる最初の月見出しにだけ**右端へ出す。各行は開催日をタイトル行から外して**行頭の日付ブロック**（日数字はゼロなし＋英字曜日。日曜=朱・土曜=藍・平日=淡墨）で表し、申込可否を**3px 色帯と大会名の太さの二重符号**で示す（色帯と太さは常に同条件。中止行は太さより淡色が優先）。月セクションは表示対象の行からのみ導出するので、フィルタで 1 行も残らなかった月は現れない。月見出しは `sticky top-0` でスクロールに追従し、次の月に入ると前月の見出しが押し出される（スクロールコンテナは `MobileShell` の `<main>`。上部バーが無いのでオフセットは持たない）。

月見出し・日付ブロックの英字（AUG / SUN）と日曜の朱・土曜の藍は、「UI 文言は日本語のみ」「朱＝警告系」原則に対する**意図的な例外**（日付の装飾タイポ・カレンダー慣習としてユーザー承認済み）。規約違反として置換しないこと。

### `/events/new` 新規作成

管理者・副管理者のみアクセス可（それ以外は `/403` へリダイレクト）。`EventForm`（`mode="create"`）を描画し、送信時は `eventFormSchema` でバリデーション後、`resolveEditionFromForm` による edition 紐付けと `events` への insert を 1 トランザクションで行い、作成後は詳細画面へリダイレクトする。作成経路は常に `status='published'` 固定（フォームに status 入力欄自体を出さない）。

### `/events/[id]` 詳細

**罫線＋余白主導（脱カード）**の画面。カードを使うのは関連メールの1件ずつだけで、他は下線付き見出し＋余白＋ヘアライン罫線で構造を作る。運営操作は `<details>` に畳み（**既定=閉**）、既定表示では会員も管理者も「どの大会か・今どの段階か・自分は出るか」だけが見える状態にする。ルート要素は `p-4` を持ち、`<main>`（共通シェル）には padding を足さない。

上から: **固定ヘッダー**（`EventDetailHeader`。日付+大会名+会場+申込フローを1つのラッパーで sticky にする。分割するとオフセット計算が壊れる）→ **グループ導線**（`GroupBackLink`。申込グループページへの戻りリンクを全ロールに表示。ラベルは固定文言「‹ 大会全体（申込・名簿）」で大会名を繰り返さず、**シングルトングループでも常に出す**——ボードが常にグループページへ着地するので、出さないと group → day で戻り導線が消える。複数日のときだけグループ名を薄く添える。sticky ヘッダーの外に置く）→ 参加者（人数を見出しに出し、苗字を級の添え字つきで羅列）→ 級別定員 → 備考 → 名簿（`RosterSection`。個人戦のみ・級タブつき・[spec/tournaments-results.md](tournaments-results.md)。種別ごとに、パース済み名簿があれば構造化表示を主として採用済み原本ファイルを補助リンクで併記し、パース済みが無く原本ファイルだけあるときは「〜名簿（原本ファイル）」としてファイル名の一覧を出す。折りたたみ見出しの件数は原本のみの種別を「未取込」と言わず `原本N件` と出す。会員へ渡すのはファイル名・種別・発表日・級・ビューア導線だけで、取込元メール ID・採用者は RSC payload に載せない。級別採用のファイルにはファイル名の脇に級ラベル（「D級」「A・B級」）が付き、グループ統一の採用（`grades` が NULL。既存データを含む）はラベルなし。**管理者・副管理者にはセクション末尾に「確定名簿ありとして扱う」トグル**が出る〔confirmed-roster-signal〕——名簿もメールも登録できないときの逃げ道で、非管理者には操作 UI も Server Action も RSC payload に載せない）→ オープンチャット（`OpenChatSection`。**全ロールに表示・表示のみ**。下記「オープンチャット欄」）→ sticky な出欠トグルボタン。**管理者に残る操作は大会名の脇と備考見出しの「編集」リンクだけ**——進行管理・LINE配信・関連メールの3セクションは申込グループページへ移設した（2026-08-20。[features/entry-group-page/requirements.md](../features/entry-group-page/requirements.md) §3.2.7）。名簿とオープンチャットはグループ帰属の同一データなので**日ページとグループページの両方に出す**（表示を増やしても状態は増えず、会員の主動線から名簿が消える方が害が大きい）。

**申込フロー**（`EntryFlow` ＋ 判定は `lib/events/entry-flow.ts` の `buildEntryFlow`）は 会内締切 → 大会申込 → 抽選 → 支払 → 開催 の5ステップを横一列に描く両ビュー共通の表示で、`events.entryStatus` / `paymentStatus` が「会としての進行」を表すため会員にも同じマイルストーンを見せる。**5ステップは日付が NULL でも消さず**、日付欄に「未定」と出す（ステップ数が大会ごとに変わると横並びの目安として機能しなくなるため）。判定はハイブリッドで、大会申込は `entryStatus==='applied'`、支払は `paymentType==='advance'` かつ `paymentStatus==='paid'`、会内締切・開催は対応する日付が JST の今日より前かで完了を決める。抽選は「抽選日が今日より前」**または**「確定名簿が取り込まれている」で完了になる — 確定名簿は抽選結果そのものなので、抽選日が未設定・未来日でも取込済みならフローを先へ進める（日付欄は「未定」のまま）。確定名簿の有無の定義は申込管理ボードと同一（下記「申込管理ボード」の 4 材料）で、判定の正典は `apps/web/src/lib/events/confirmed-roster.ts`。`applicant`（申込者名簿）は影響しない。この帯は会員が見る `/events/[id]` にも同じ判定で描かれる（ボードと会員画面でフェーズがずれない）。事前払い以外の支払と `not_applying` 時の 大会申込〜支払 は**中立**（完了・警告・現在地のいずれにもならない）。現在地は「完了でも中立でもない」最先頭の高々1つで、`not_applying` のときは出さない。警告（朱）は**期限超過かつ未完了**のときだけで、単なる未払を警告にはしない。


**振込締切の「状態」**（`events.payment_deadline_kind`。`fixed` / `later_notice` / `unspecified`）は日付と対で扱う。`payment_deadline` が空である理由には「案内に『振込先は抽選後に別途連絡』と書いてあった（`later_notice`）」と「そもそも記載が無い／読み取れなかった（`unspecified`）」の2種類があり、前者は追加調査不要・後者は原文を当たるべき状態で対応がまったく違う。承認時に AI ペイロードの3値からマッピングされ（[spec/mail-worker.md](mail-worker.md)）、その後は編集フォームで人が変更できる（後日連絡だったものに連絡が来たとき日付へ書き換えられることが実用上の要）。

DB 側は CHECK `(payment_deadline IS NOT NULL) = (payment_deadline_kind = 'fixed')` で双条件に縛られているため、**この2列は必ず同じ INSERT / UPDATE で揃えて書く**。正規化は `apps/web/src/lib/events/payment-deadline.ts` の `normalizePaymentDeadline`（日付が正 —— 日付があれば必ず `fixed`）で、`eventFormSchema` の transform に置いてある。作成・編集・メール承認の3経路がすべてこの schema を通るので、日付を入れたら状態が `fixed` へ倒れるのは**サーバー側で**担保される（クライアント側のバリデーションだけに頼ると CHECK 違反で 500 になる）。グループページの共通項目保存も schema を通らないため、そちらは `normalizePaymentDeadline` を直接経由して2列を揃える（`saveGroupCommonFields`）。UI は日本語表示（`fixed`→日付そのもの / `later_notice`→「後日連絡」/ `unspecified`→「締切未設定」）。「後日連絡」は**期限超過扱いにしない**（締切が決まっていないのだから遅延ではない）。


一般会員には 支払締切・支払方法・支払情報・申込方法・`events.fee_jpy` の格納値・振込総額 を描画しない（RSC payload にも載せない）。これらは申込グループページの「進行管理」（管理者のみ）に集約されており、会員向けの周知は LINE グループへ配信される要綱に委ねている。**例外は「あなたの参加費」の1行**で、参加者セクション内に自分の級の単価だけを全ロールへ出す（`memberEntryFeeJpy`。個人戦のみ・級が対象級に含まれるときのみ・出欠の回答状況は問わない。他人の額も総額も見えない）。単価の決め方は下記「参加費の解決」。日付は生 ISO を出さず、文脈ごとに `9/6(日)`（見出し・フラット表）／`7/31`（申込フロー・曜日なし）／`2026/07/20 14:32`（LINE 連携状況）／`7/25 18:02`（配信履歴・名簿の発行日）を使い分ける（整形は `lib/event-date.ts`）。


出欠回答不可の会員には理由（対象外／会内締切超過／級未設定／対象外の級）をカードで示す。

**参加費の解決**（`lib/entry-fee.ts` の `resolveEntryFee`。画面・LINE 通知の全経路がここを通る）: `official=true` かつ `kind='individual'` なら **`events.fee_jpy` を一切見ず**、級から公認大会の規定額（`OFFICIAL_ENTRY_FEE_JPY`）を常に導出する。それ以外（非公認・団体戦）は `events.fee_jpy` をそのまま単価にする。`fee_jpy ?? 導出` ではない — 公認大会の参加料は協会規定で大会ごとの裁量が無く、スカラー1列では同日に複数級が開催される大会の級別金額を表現できない（実際に本番データが誤っている）。対象級は `events.eligible_grades`（NULL / 空配列なら全級）で、同一単価の級はまとめて `A・B級 2,500円 / C級 2,000円` の形に整形する。申込グループページの「支払状態」には単価に加えて**振込総額**と内訳（級ごとの人数×単価）を出す。振込総額は申込グループを1つにまとめた額で、**中止した日**と**事前払い以外の日**（現地払い＝当日各自が払う／NULL＝支払い通知なし）は除く（`setPaymentType` は1日単位で変更できるため同一グループ内で支払方法が混在しうる）。総額の母集団は参加者一覧（`attend=true` ∩ `is_invited` ∩ 対象級）と同一で、級未設定の会員は 0 円で足さず未算入として注記する（`lib/entry-fee-tally.ts`）。団体戦・非公認では人数×単価が成立しないため総額を出さない。

**オープンチャット欄**（`OpenChatSection`。openchat-broadcast）は、大会当日用の LINE オープンチャット招待 URL を**ログイン済みの全会員**へ出す表示専用のセクション。追加・編集・削除の導線は置かない（編集はメール詳細の抽出フローからのみ）。帰属は**申込グループ**（`entry_group_open_chats.entry_group_id`）なので**開催日で絞らない** — 6/21 の詳細でも 6/20 対象の行が見える。対象日はラベルに出るので取り違えは起きず、「別の日のオプチャが見つからない」事故を防ぐ方を優先した。行は `ORDER BY sort_order, id` で取り、**取得順のまま描画する**（LINE を見逃した会員が配信済み Flex と同じ順序で辿れるようにするため。DTO は `sortOrder` を持たず、コンポーネント側で再ソートできない形にしてある）。ラベルは Flex と同一の `resolveOpenChatLabel`（`lib/open-chat/label.ts`）で解決するので必ず一致する。**保存済みが0件のときは見出しごと出さない** —「未設定」と出すと会員に「運営が忘れている」と読ませるが、実際は主催者がまだ配っていないだけのことが多い。

### `/events/[id]/edit` 編集

管理者・副管理者のみ。既存イベントを `EventForm`（`mode="edit"`）に事前入力し、edition 紐付けの現況（`editionDefault`）も渡す。`mode="edit"` のときのみステータス選択（公開(通常)/中止/終了）を表示し、中止からの復帰は「公開(通常)」を選ぶ。更新後は詳細画面へリダイレクトする。

**entry-groups: 「申込グループ」欄**（`EntryGroupFieldset`。standalone モードのみ＝承認フォームの
埋め込みには出さない）。現在のグループと所属日の一覧を表示し、**単独化**（新しいシングルトングループへ
分離）と**合流**（既存グループへ移動。候補は同じ `tournament_draft` 由来のグループ＋開催日が近い順の
検索）ができる。付け替えは `updateEvent` と同一トランザクションで行い、移動元グループに対して
`deleteGroupIfEmpty` を呼ぶ。合流先 id はサーバー側で実在を再検証する。

**このフォームは日固有項目だけを扱う**（2026-08-20）。グループ共通の7項目（申込締切・会内締切・
抽選日・支払締切〔日付＋状態〕・支払方法・振込先・申込方法＝`PROPAGATABLE_FIELD_KEYS`）は
`EventForm` の `hideGroupCommonFields` で**描画しない**。編集はグループページの「共通項目」1箇所に
定まり、伝播確認ダイアログ（`EventEditSubmit`）は撤去した。残るのはタイトル・正式名称・開催日・場所・
対象級・級別定員・全体定員・参加費・主催・区分・公認/非公認・備考・edition 紐付け・申込グループ欄。

★**`updateEvent` は共通7項目（8キー）を UPDATE の SET から明示的に除外する。** 入力が描画されないと
`extractEventFormData` はそれらを `null` として読むため、除外しないとグループページで設定した締切・
振込先が日ページの保存のたびに `null` で上書きされて消える。作成経路（`/events/new`・メール承認
`ApprovalForm`）は従来どおり全項目を出す（グループがまだ確定していないため）。

### `/admin/entries` 申込管理ボード

ログイン会員なら誰でもアクセス可（未ログイン・未紐付けのみ `/403` へリダイレクト。role による絞りはしない）。会レベルの申込進捗を大会単位で一望する**表示専用**画面で、状態を変える操作は持たない（変更はすべて `/events/[id]` の進行管理パネル）。ボトムナビの `申込管理` タブから入る。当初は管理者専用だったが、表示専用であり会員も知りたい情報なので閲覧を開放した——表示項目の role 出し分けはせず、行タップの遷移先も全員 `/admin/entries/[groupId]`（申込グループページ。操作 UI はその画面側が role で出し分ける）。URL の `/admin/` プレフィックスは既存導線・テストへの波及を避けて据え置いている。

母集団は「開催日が JST 今日以降」「`status != 'cancelled'`」「`kind = 'individual'`」を満たす `events` から、**非表示条件**（`entryStatus='not_applying'` ／ 基準締切が非NULLかつ超過済みで出欠「参加」0名）に該当するものを引いたもの。団体戦を外すのは確定名簿が個人戦専用の仕様で、含めると「確定名簿が永遠に出ない」大会が申込済み区画に滞留するため。

**entry-groups: 1グループ = 常に1行**（2026-07-28 変更。それ以前は日別行を持つカードだった）。行にはグループ表示名・
参加希望者数・残日数・日付だけを出し、タップすると**申込グループページ**へ遷移する（2026-08-20 変更。
それ以前は代表イベントの詳細だった）。シングルトングループを含む**全行**が同じ着地点になる——行によって
着地先が変わると「大会名を押したら何が出るか」が予測できなくなるため。件数ピルはグループ数を数える
（複数日グループは1件）。グループがどの区画に入るかは `[要申込, 名簿確定・要振込, 申込完了・抽選待ち, 締切前, 完了]` の優先順位で
**最も対応が必要な区画**へ寄せる（管理者が見落とさない側＝安全側）。

複数日グループを1行に畳むための集約規則は2つだけ。**日付・残日数はその区画で見る日付が可視日のうち最も早いもの**
（並び順キーと同値なので並びと表示が一致する）、**参加希望者数は可視日の合計**。集約母集団は可視日のみで、
非表示条件で落ちた日は数にも日付にも含めない。

この結果、**グループ内で締切や進行状態が日ごとに食い違っても、その差はボードからは見えない**（内訳は行タップで
大会詳細へ入る）。区画寄せが「最も対応が必要な区画」へ倒れるので見落とし方向には倒れない、という判断で受容している
（[features/entry-management/requirements.md](../features/entry-management/requirements.md) §3.2.5.1・設計判断18）。

グループ表示名と代表イベントの導出は**サーバー（page.tsx）で一度だけ行い**、結果を平らな値
（`groupName` / `groupRepresentativeEventId`）として `EntryBoardItem` に持たせて client component へ
渡す。`EntryBoardClient` は `'use client'` で、`@/lib/entry-groups` は drizzle スキーマを値 import する
（DB 層）ため、そこから直接呼ぶとクライアントバンドルにスキーマが載る。この汚染は
eslint / vitest / check-types では検知できず `next build` でしか出ない。

日別の進行フェーズは**永続カラムを持たず既存列から毎回導出する**。各**日**はちょうど1つの区画に入る（ライフサイクル順）。
区画名は2026-07-28に改称した（**判定条件・並び順・強調条件と内部識別子 `AreaId` は不変**。変わったのは表示文字列だけ）:

| 区画（内部ID） | 条件 | 表示・整列に使う日付 |
|---|---|---|
| 締切前（`before_deadline`） | `not_applied` かつ 基準締切がNULLまたは今日以降 | 会内締切（`COALESCE(internalDeadline, entryDeadline)`） |
| 要申込（`action_required`。旧「要対応」） | `not_applied` かつ 基準締切が今日より前 かつ 参加1名以上 | **本締切**（`entryDeadline`） |
| 申込完了・抽選待ち（`applied_waiting`。旧「申込済み・抽選待ち」） | `applied` かつ `paymentType='advance'` かつ `paymentStatus='unpaid'` かつ 確定名簿なし | 抽選日（`lotteryDate`） |
| 名簿確定・要振込（`payment_due`。旧「名簿確定・振込待ち」） | `applied` かつ 確定名簿あり かつ `paymentType='advance'` かつ `paymentStatus='unpaid'` | 支払締切（`paymentDeadline`。null のときは `paymentDeadlineKind` で「後日連絡」/「締切未設定」を出し分ける） |
| 完了（`done`） | `applied` かつ（`paymentStatus='paid'` または `paymentType='onsite'` または `paymentType IS NULL`）。**確定名簿の有無を問わない** | 開催日（`eventDate`） |

改称の狙いは「要対応」が**何をすべきか**を伝えていなかったこと。区画名がそのまま次の動作（申し込む・振り込む）を指すようにした。
※ かつて `/admin/mail-inbox` にも tier 0「要対応」ラベルがあったが、そちらは mail-ai-extract-refinements で廃止済み（無関係な同名だった）。

確定名簿ありの判定は**グループ単位の4材料の OR**（正典は `apps/web/src/lib/events/confirmed-roster.ts`。ボード・申込グループページ・大会詳細の3画面が同じ関数を使う）: ① `tournament_entry_rosters` に `rosterType='confirmed'` かつ `supersededAt IS NULL` の行がある（＝メール取込フローで承認した時点）／② `tournament_entry_roster_files` に `rosterType='confirmed'` の採用がある（＝解析せず原本ファイルのまま登録。版管理を持たないので superseded の絞り込みは無い）／③ `mail_messages` に `mailKind='confirmed_roster'` かつ `triageStatus='processed'` で、`linkedEventId` がそのグループの `events` を指す行がある（**添付の有無・採用の有無を問わない**。本文だけの確定連絡でフェーズが構造的に進めなくなる実害が出たため。帰属は `linked_event_id → events.entry_group_id` の間接参照で、イベントを別グループへ付け替えるとシグナルもイベントに付いて移動する）／④ `entry_groups.confirmedRosterOverride = true`（管理者が名簿セクションで立てる手動フラグ。①〜③が無くても単独で成立し、「未処理に戻す」の対象外）。③④は**申込済み（`applied`）のグループにしか効かない** — `classify` が `hasConfirmedRoster` を見るのは `applied` 分岐だけなので、未申込のグループでフラグを立てても区画は動かない。**③④は出場者解決（ホーム・外部API）には波及させない意図的な非対称**で、これらは名簿の中身を持たないため、混ぜると出場者が空リストになる（[ホーム画面（ダッシュボード）](#ホーム画面ダッシュボード)の確度 2 系統は従来どおり①のみ）。決定論パーサは主催者ごとに多様な様式へ追随できず、確定名簿が 1 件も取り込めないまま事前払いの大会が「申込完了・抽選待ち」に滞留する実害が出たため、原本の採用だけでフェーズを進められるようにした（[features/roster-file-adoption/requirements.md](../features/roster-file-adoption/requirements.md)）。`applicant` のファイル採用は分類を動かさない。区画の判定条件・評価順・並び順キーはこの定義拡張以外に変更していない。**確定名簿は「完了」の必須要件ではない**（2026-07-27 変更）: 確定名簿は主催者の発表とこちらの取込作業が両方揃って初めて true になる外部依存の値なので、支払いの決着（振込済／現地払い／支払い管理なし）が付いた大会は名簿を待たずに完了へ抜ける。名簿の有無が結果を左右するのは**事前払いかつ未振込**の大会を「抽選待ち」と「振込待ち」のどちらに置くかだけ。現地払い・支払い管理なしの大会には振込確認という判定点が無いため、申込済みになった時点で完了へ入る（＝抽選待ちを経由しない。追跡価値より滞留の害が上回るというユーザー判断）。「要申込」だけ会内締切ではなく本締切を見るのは、その区画が会内締切を既に過ぎた大会の集まりであり、行動を決めるのは主催者への申込締切だから。並び順はいずれも昇順・NULL末尾・開催日を副キー。

行にはグループ表示名（単独イベントなら通称 `tournament_series.short_name` + 対象級。edition 未紐付けは `title` フォールバックで幅により省略）+ 参加希望者数 `（N名）`、残日数、日付を出す。参加希望者数は `attend=true` の素通し件数で `/events` 一覧と同じセマンティクス（対象級で絞ると対象級外の表明で0名と判定され、大会が自動的に非表示になってしまうため安全側に倒している）。残日数は超過・当日・3日以内のときだけ出し、「申込完了・抽選待ち」「完了」では一切出さない。日付の種類名は各区画の見出しに1回だけ置き、行の日付列と右端を揃える（見出しが列見出しとして機能する）。

「要申込」「名簿確定・要振込」の2区画のみ、その区画で見ている日付が**今日以前または未設定**の大会を1件以上抱えるとき強調表示する（未設定を到来済み扱いにするのは fail-safe）。常時強調しないのは赤が背景と化して効かなくなるのを防ぐため。**0件の区画は行動フェーズであっても朱にしない**（空＝その行動は今やることが無いので色で注意を引く理由が無い。2026-07-28 明文化）。「締切前」区画だけ見出しタップで開閉でき（既定は開・永続化しない）、畳んでも会内締切3日以内の行は残して隠れた件数を `ほかN件` で示す。0件の区画は見出しを残して `なし` を出し、区画自体は消さない（位置が件数で動くと一目性が失われる）。母集団が0件のときだけ画面全体を空状態に差し替える。

見た目（区画をレール＋和紙の面で束ねる／見出しは明朝・藍／玉は見出し行の中）の正典は [features/entry-management/design-spec.md](../features/entry-management/design-spec.md)（round 13・locked）と同ディレクトリの `design-mock/`。**375px でスクロールが出ないことがこの画面の最優先制約**。

日付判定はサーバーで確定した JST の `YYYY-MM-DD` を渡して文字列比較する（クライアントで `Date.now()` を呼ぶと hydration mismatch になる）。仕分け・並び順・日付バッジ・強調判定は `admin/entries/entry-board-utils.ts` の純関数。毎朝の `entry-overdue-alert` も「要申込」と同じ対象定義を使う（[spec/notifications.md](notifications.md)）。

### `/admin/entries/[groupId]` 申込グループページ

申込・締切・名簿・LINE 連絡・入金は申込グループ単位で行われるため、**管理者の申込運用の起点**をこの1画面に集約する（2026-08-20 新設。[features/entry-group-page/requirements.md](../features/entry-group-page/requirements.md)）。

**閲覧はログイン済みの全ロール**（admin / vice_admin / member）。ゲストは middleware の許可リストに該当せず `/403`（ページ側にも fail-safe の `redirect`）。ボード `/admin/entries` が会員全員に開放済みなので、その遷移先を管理者専用にすると会員に死んだリンクが生まれる。**操作 UI（進行管理・共通項目・LINE配信・申込書・関連メール）は管理者/副管理者にのみ描画し、非管理者には値を計算せず RSC payload にも載せない**（`/events/[id]` と同じ規約。JSX の条件分岐で隠すだけでは client component へ渡した props が payload に出る）。表示ロールのプレビュー中は表示ロールに従う。存在しない `groupId` とイベント0件のグループはどちらも 404。

セクションは上から **ヘッダー（パンくず・グループ名・開催日の並び・共通締切）→ 申込フロー帯 → 日程 → 進行管理 → 共通項目 → LINE配信 → 名簿 → オープンチャット → 関連メール**。ヘッダーとフロー帯は1つのラッパーで sticky にし（日ページと同じ型なので行き来しても目が迷わない）、運営操作は既定=閉の `<details>` に畳む。グループ名は `deriveEntryGroupName`（保存しない）で、導出不能なら代表イベントのタイトルへフォールバックする。

**申込フロー帯**は日ページと**同じ `EntryFlow` / `buildEntryFlow`** を使い、グループから集約した入力（`aggregateGroupFlowInput`）を渡すだけ。判定規則が2箇所に分裂しないようにするため。集約は判定母集団＝`status <> 'cancelled'` の日（対象日）で、開催日＝対象日の最も早い日、申込状態＝申込対象日（`not_applying` でない対象日）が0件なら `not_applying`・すべて `applied` なら `applied`・それ以外は `not_applied`、支払タイプ＝申込対象日に `advance` があれば `advance`／無く `onsite` があれば `onsite`／どちらも無ければ NULL、支払状態＝申込対象日の `advance` の日がすべて `paid` なら `paid`。**対象日が0件（全日中止）ならフロー帯を描かない**。「申し込まない日を除いた残りが全部揃ったら完了」にしたのは、本番の多摩CDE（C だけ申込済・D/E は申し込まない）で「1日でも進んでいれば完了」は楽観的すぎ、「全日揃って完了」は永遠に完了しないため。

**日程表**（`GroupDayTable`）はグループ内の全イベントを開催日昇順（同着は id 昇順）で並べ、`cancelled` の日も行として残す。各行は 開催日 → 大会名（通称ベース `displayName`）→ 対象級 → 自分の回答印 → **進行フェーズ1語** → 参加希望者数 → シェブロン で、行タップで `/events/[id]` へ遷移する。**フェーズ1語の語彙は申込管理ボードの区画名と同一**（`要申込 / 抽選待ち / 要振込 / 完了 / 申込なし / 締切前 / 中止`。この画面だけの造語を作らない）で、判定はボードの `classify` をそのまま日ごとに回し、短縮ラベルは `AREAS` の `label` から機械的に導出する（`admin/entries/day-phase.ts`）。`no_applicants` に畳まれる2ケース（申し込まない／未申込かつ希望者0名かつ締切超過）はどちらも「申込なし」で、理由は同じ行の参加希望者数が示す。参加希望者数は `attend=true` の素通しで**ゲストは数えない**（`/events` 一覧・ボードと同じセマンティクス）。**日程表の内容は管理者と一般会員で同一で、差は選択チェックボックスの有無だけ**。中止の日は色を足さず `opacity` で落とし、チェックボックスを押せなくする。フェーズ語も表示用の値もサーバーで確定させて client へ渡す（`classify` を client バンドルへ持ち込まないため）。

**一括操作**は日程表の直下。「日を選んでまとめて適用する」1つの形に統一され、既定は選択可能な日すべてにチェック。前進3種（申込済にする・支払済にする・支払タイプ変更）はボタン、後退3種（未申込に戻す・申し込まない・未払に戻す）は「戻す操作」の `<details>` に畳んで誤操作を1段遠ざける。1日も選択していない、または選択した日の状態が1つも動かないときはボタンを無効化する。通知の集約規則は変えていない（下記「進行管理フロー」）。

**進行管理**（管理者のみ）は**表示専用**で、申込状態・申込書・支払状態（振込総額・級別内訳・振込先・支払締切）を集約ラベル（例「2日とも申込済」「1／3日 支払済」）で示す。**日ごとのトグルを置かない**——状態の切り替えは必ず日程表で日を選んでから行い、「どこで申込済にするのか」を1箇所に定める。申込書ウィザード（`/admin/entry-form/[groupId]`）への導線は個人戦のみ（団体戦では名簿セクションともども出さない）。

**共通項目**（管理者のみ）は7項目のインライン編集で、保存はグループ全日（`cancelled` 含む）へ同一トランザクション。値は全日一致ならその値、食い違えば**最も早い日付**（日付以外の項目は代表イベントの値）を主に出し、朱で「（日により異なる）」を添える（`aggregateGroupCommonFields`）。食い違ったまま運用することは許容されている（締切リマインドは締切日ごとに別通で飛ぶ）が、大半は伝播し忘れの事故なので気づける形にした。アクションは「編集して揃える」1本。

**LINE配信・名簿・オープンチャット・関連メール**はいずれもグループ帰属。関連メールはグループ**全日分の UNION**（`collectRelatedMailIdsForGroup`。重複は `mail_messages.id` で dedup・受信日降順）。級別グループ配信だけは event 単位の状態なので**日ごとに1行**出す（代表イベントだけに畳むと複数日グループで他の日へ配信する手段が失われる。1日だけのグループの描画は日ページ時代と同一）。

朱（`--kg-accent` 系）を使うのは **期限超過・要対応フェーズ（要申込／要振込）・共通項目の食い違い**の3つだけ。視覚の正は [features/entry-group-page/design-spec.md](../features/entry-group-page/design-spec.md)（locked・案C）と同ディレクトリの `design-mock/`。

### `/admin/entry-form/[groupId]` 申込書作成プレビュー

申込グループ単位で申込書 xlsx を自動記入し、Yahoo メールの下書きを作る（admin / vice_admin のみ）。3ステップのウィザード。

1. **テンプレ選択と列対応の確認** — グループに紐付く取込メール（`tournament_draft` 経由）の `.xlsx` 添付を候補として提示する。手動アップロードも常に可能。選択すると列対応（どの列に何を書くか）をコードのヒューリスティックで推定し、低信頼のときだけ Claude Haiku へフォールバックする。どちらの結果もこの画面で目視確認・手動修正する
2. **対象会員** — グループ内全イベントの `attend=true` の和集合（会員単位で重複排除）。行の除外・再追加と全セルの編集ができる。姓名・かな未登録／級未設定／出場回数が名簿欠落で過少の3種を警告として先出しする。姓名・かなの入力値は `users` の `family_name` / `given_name` / `family_kana` / `given_kana` へ書き戻す（`name` は変更しない）
3. **メール下書き** — 宛先・件名・添付ファイル名・本文をプレフィルして編集させる。プレフィルの出所（申込書から抽出／主催者指定を AI 抽出／定型）をバッジで示す

確定すると **xlsx を記入 → MIME を組み立て（＝宛先・差出人の検証）→ 作成履歴（`entry_form_drafts`。生成 xlsx のコピーを含む）を `appending` で保存 → IMAP APPEND で Yahoo の `Draft` フォルダへ書き込む → 成功なら `created`、失敗なら `imap_failed` に更新** する。MIME 組立を履歴保存より前に置くのは、入力ミスを IMAP 障害として記録しないため（失敗画面には直す導線が無い）。履歴の保存は APPEND より前なので、Yahoo への書き込みが失敗しても編集値と生成 xlsx は失われない（失敗画面からその場でダウンロードでき、再試行もできる）。`appending` のまま残った行は「結果が確認できていない」扱いで、成功とは表示しない。失敗のやり直しは**同じ履歴行と同じ Message-ID** を使い、APPEND の前に Draft を Message-ID で照合する（「APPEND は成功したが応答が返らなかった」あとの再試行で下書きが重複しないため）。宛先の形式検証と MIME 組立は履歴保存より前に行い、入力ミスを IMAP 障害として記録しない。

級別複数シートのテンプレでは、各シートの対象級が決まっていること・同じ級が複数シートに割り当てられていないことをプレビューと Server Action の両方で検証する（前者は全員が全シートに、後者は該当者が2枚に重複記入されるため）。

参加級は `users.grade` を初期値にしつつ**自由入力**で、F級など大会独自級や当日昇級に対応する。級別シートへの振り分けと級別人数の集計は A〜E に一致する値だけを対象にし、独自級の会員は「どのシートにも該当しない」として作成後に警告する。

**送信機構は持たない。** SMTP・送信 API への依存が無く、Yahoo への書き込みは IMAP APPEND だけなので、このシステムからメールが送信されることはアーキテクチャ上あり得ない。送信は管理者が Yahoo メールで下書きを確認して手動で行う。本機能は `events.entry_status` を変更しない（「申込済にする」は従来どおり手動）。

### `/settings/entry-form` 申込書設定

申込書ヘッダ欄と申込メールに使う会の定数6項目（都道府県／所属会名／申込責任者氏名／連絡先電話番号／連絡先 E-Mail／振込名義人）を編集する（admin / vice_admin のみ）。値は `app_settings` に `entry_form.` 接頭辞の key-value として保存する。責任者交代はこの画面の編集だけで完結する。

### `/events-archive` 過去のイベント

過去日（JST 今日より前）のイベントを開催日降順のカードリストで表示。並び替え/フィルタは無く、タイトル・公認バッジ・開催日・会場（設定時）・ステータスピル・参加人数を示す簡易ビュー。

## フロー

### 出欠回答フロー

1. 会員が `/events/[id]` を開く（未ログインは回答不可）
2. サーバーが `isAdmin` / `isInvited` / `internalDeadline` / `eligibleGrades` から `canRespond` を算出し、回答可否と UI 出し分けを決める
3. 回答可能なら sticky ボタンで参加/キャンセルをトグル（`attend` のみ送信）、または折り畳みのコメント欄から `comment` のみ送信
4. `submitAttendance` がサーバー側でも同じガードを再検証し、`event_attendances` を upsert
5. `revalidatePath` でグループ内の各イベント詳細・**申込グループページ・申込管理ボード**を再検証する（`revalidateAfterLifecycleChange`。操作の入口がグループページへ移ったので、日ページだけ捨てると操作した当の画面が古いフェーズ語のまま残る）

### イベント作成・編集フロー

1. 管理者が `/events/new` または `/events/[id]/edit` でフォームへ入力（タイトル・日付・場所・定員・締切各種・対象級・参加費・支払関連・主催・申込方法・説明・開催紐付け）
2. サーバーアクションが `eventFormSchema`（`form-schemas.ts`）でバリデーション
3. `resolveEditionFromForm` で開催（edition）の紐付けを解決（詳細は [spec/tournaments-results.md](tournaments-results.md)）
4. `events` テーブルへ insert/update し、詳細画面へリダイレクト

`EventForm` は「大会案内 AI 抽出→承認」画面（`extractEventUnitsFormData` 経由。詳細は [spec/mail-worker.md](mail-worker.md)）からも `fieldPrefix` 付きの埋め込みモードで再利用される。埋め込みモードでは抽選日・開催紐付け・カード/フォーム外枠を描画しない（親コンポーネントが複数ユニット分をまとめて 1 つの `<form>` に束ねるため）。

### 進行管理（申込/支払い状態）フロー

1. 管理者が `/admin/entries/[groupId]`（申込グループページ）の**日程表で対象の日を選び**、一括操作バーのボタンを押す（2026-08-20 変更。それ以前は `/events/[id]` の進行管理トグル＋伝播確認ダイアログだった）。前進3種はボタン、後退3種は「戻す操作」の `<details>` の中。既定は選択可能な日すべてにチェックで、`cancelled` の日は選択できない。ボタンは選択した日のうち1日でも状態が動くときだけ活性になる（`applied` から直接 `not_applying` へは遷移させず「未申込に戻す」を経由する2手順は維持。状態機械を単純に保つため）
2. LINE グループが紐付き済み（`isLineLinked`）かつ通知を伴う操作（申込済化・支払済化。取り消し方向や支払いタイプ変更は通知なし）なら、クライアントで `window.confirm` による確認を挟む。「申し込まない」は LINE 通知を伴わないが `/events` 一覧から消える不可視化を伴うため、`isLineLinked` に関係なく別文言の確認を必ず出す（解除側は確認なし）
3. `setEntriesApplied` / `setPaymentsPaid` が選択した全 `eventId` を1回の Server Action 呼び出しで受け、id 昇順で各日をガード付き UPDATE（`not_applied → applied` 等の初回遷移のみ）し、同一トランザクションで通知 claim（`claimLifecycleNotification`）を行う。再トグルや二重呼び出しでは 2 回目以降は通知されない（once-ever は `(event_id, type)` 単位）
4. コミット後、push 送信は best-effort（失敗しても状態変更はロールバックしない）
5. `revalidatePath` でイベント詳細を再検証

支払いタイプを `advance` から離れる方向へ変更すると、`paymentStatus`/`paymentPaidAt` は自動的に未払へ戻す（ただし once-ever 通知 claim ログ自体は削除しない＝再度支払済にしても完了通知は再送されない）。

**通知の集約規則は変わっていない。** 選択した全 `eventId` を同一 tx で claim し、flip できた日のうち claim できた集合だけで参加者向け・会計向けそれぞれ**1通に集約**して push する。後から追加した日を申込済にすると「新たに claim できた日の分だけ」の通知が1通飛ぶ（既送分は再送しない）。`cancelled` の日はサーバー側でも tx 内で再ガードして claim 対象から除外する（クライアントの選択を信用しない fail-closed）。通知組み立ての詳細は [spec/notifications.md](notifications.md)。

## API（Server Actions）

### `submitAttendance(eventId, formData)` — `events/[id]/actions.ts`

ログイン必須。管理者以外は `isInvited` / 会内締切 / 対象級を再検証してからエラーを投げる（クライアント側の `canRespond` 判定をサーバーでも信頼しない）。`attend` は常に更新、`comment` は `formData` に `comment` キーが存在するときのみ更新する（トグル送信では省略されるため既存コメントを保持）。`event_attendances(eventId, userId)` の UNIQUE を使った upsert。

### `createEvent(formData)` / `updateEvent(formData)` — `events/new/page.tsx` / `events/[id]/edit/page.tsx` 内の inline server action

管理者・副管理者ガード（`session.user.role`）。`eventFormSchema.safeParse(extractEventFormData(formData))` でバリデーションし、失敗時は最初のエラーメッセージを添えて例外を投げる。対象級チェックボックス（`grade_A`〜`grade_E`）はスキーマ外で個別に読み取り、`eligibleGrades` 配列に組み立てる。`resolveEditionFromForm` による edition 解決と `events` insert/update を 1 トランザクションで行う。

### `setEntryApplied(eventId, applied)` / `setEntryNotApplying(eventId)` / `setPaymentType(eventId, type)` / `setPaymentPaid(eventId, paid)` — `events/[id]/actions.ts`

いずれも管理者・副管理者専用（`requireAdminSession()`）。`entryStatus` / `paymentType` / `paymentStatus` の更新自体はこのドメインの管轄だが、初回遷移で発火する LINE 通知の組み立て・送信ロジックは [spec/notifications.md](notifications.md) が正典。`cancelled` ステータスの大会には通知しない（状態変更自体は記録する）。

`setEntryNotApplying` は `entryStatus='not_applying'`・`entryAppliedAt=null` へ UPDATE し、通知 claim も push も行わない（対外的なアクションを伴わない内部判断のため）。`entryStatus` が `/events` 一覧の表示可否を左右するため、詳細ページに加えて `/events` も `revalidatePath` する（`setEntryApplied` の解除分岐も同様）。

### `setEntriesApplied(eventIds, applied)` / `setEntriesNotApplying(eventIds)` / `setPaymentsPaid(eventIds, paid)` / `setPaymentTypes(eventIds, type)` — `events/[id]/actions.ts`

`setEntryApplied` / `setEntryNotApplying` / `setPaymentPaid` / `setPaymentType` はそれぞれこの複数形版への薄いラッパー（`bulk([eventId], ...)`）で、単一 `eventId` を渡した場合の状態遷移・claim・文面は従来と完全に同一。`eventIds` は重複除去して id 昇順にソートし、先頭 id から解決した `entry_group_id` を全 UPDATE の WHERE に併記する fail-closed（グループ外の id はクライアントの申告を信用せず無条件に対象から外れる）。`setEntriesApplied(ids, true)` / `setPaymentsPaid(ids, true)` は各 id をガード付き UPDATE → flip できた行のうち `cancelled` はここで再ガードして claim 対象から除外 → 種別ごとに独立 claim → **claim できた集合だけ**で参加者向け・会計向けそれぞれ1通に集約 push する（`sendClaimedNotificationBulk`、[spec/notifications.md](notifications.md)）。逆方向（`applied=false` / `paid=false`）と `setPaymentTypes` / `setEntriesNotApplying` は通知を送らない。`revalidatePath` は共通ヘルパー `revalidateAfterLifecycleChange` でグループ内の各 `/events/[id]`・`/admin/entries/[groupId]`・`/admin/entries` を再検証する（一括操作の入口がグループページになったため）。

### `setConfirmedRosterOverride(entryGroupId, value)` — `events/[id]/actions.ts`

admin / vice_admin のみ（`requireAdminSession()`）。`entry_groups.confirmed_roster_override` を書き換えるだけの操作で、通知は送らず監査情報も残さない。グループ実在確認のうえ UPDATE し、`revalidateAfterLifecycleChange` にグループ内の全 `events.id` を渡して各日の詳細・グループページ・ボードを再検証する（フロー帯は会員が見る `/events/[id]` にも出るため、グループページだけを捨てると会員側に古いフェーズが残る）。UI は名簿セクション（`RosterSection`）の末尾で、管理者向けの値と bind 済みアクションは `adminControls` 1 つに束ねて管理者のときだけ渡す。**露出条件はグループ単位**——`/events/[id]` の `RosterSection` は「その日の `kind`」で描かれるため、個人戦と団体戦が混在するグループでは個人戦の日からグループ全体のフラグを立てられてしまう。日ページ・グループページとも「グループに1日でも団体戦があれば出さない」で揃え、Server Action 側も `value=true` のときだけ同じ検証を行う（`isIndividualOnlyGroup`。Action ID 直叩きに対して fail-closed）。**OFF は常に許可する**——ON の後にグループへ団体戦の日が加わっても解除できなくなる状態を作らないため。効くのは申込済みグループの抽選→支払だけで、任意のフェーズを選ぶ機能ではない（[features/confirmed-roster-signal/requirements.md](../features/confirmed-roster-signal/requirements.md)）。

### `saveGroupCommonFields(groupId, input)` — `admin/entries/[groupId]/actions.ts`

admin / vice_admin のみ。申込グループページの「共通項目」からグループ共通7項目（`PROPAGATABLE_FIELD_KEYS` と同一の集合）を**グループ内の全イベント（`cancelled` 含む）へ同一トランザクションで**保存する。入力は zod で再検証し、支払締切は `normalizePaymentDeadline` を必ず経由して日付と `payment_deadline_kind` を揃える（CHECK 制約）。書き込みは `propagateFieldsToGroup` を再利用するので、id 昇順ロック（デッドロック回避）と `WHERE entry_group_id` の再検証（fail-closed）はそのまま効く。日ページの編集フォーム経由の伝播と違い `diffPropagatableFields` は**使わない** ——「差分を伝播する」のではなく「グループ全日をこの入力値へ揃える」操作だから。7項目以外の列は SET しない。

### `loadEntryFormContext(groupId)` / `analyzeTemplateAction(input)` / `saveMemberNamesAction(entries)` / `createEntryFormDraftAction(input)` — `admin/entry-form/[groupId]/actions.ts`

いずれも admin / vice_admin のみ。`loadEntryFormContext` はグループのメタ情報・テンプレ候補・対象会員（出場回数のプレフィル込み）・会定数・最新の作成履歴を1度に返す。`analyzeTemplateAction` は列対応の推定（ヒューリスティック→低信頼時のみ AI）と、案内メール本文からの主催者指定（件名・添付ファイル名・申込先）の抽出を行う。`saveMemberNamesAction` は姓名・かなの4フィールドだけを `users` へ書き戻す。`createEntryFormDraftAction` は「xlsx 記入 → 履歴保存 → MIME → IMAP APPEND → status 更新」の順に実行し、APPEND 失敗時は `status='imap_failed'` と `imap_error` を記録して結果を返す（例外にしない）。どのシートにも該当しなかった会員数・テンプレ行数を超えた会員数も戻り値に含め、画面で警告する。

### `extractOpenChatCandidatesFromMail(args)` / `saveAndBroadcastOpenChats(input, options)` / `broadcastOpenChats(args)` / `loadOpenChatBroadcastSummary(groupId)` — `admin/mail-inbox/open-chat-actions.ts`

いずれも admin / vice_admin のみ（openchat-broadcast。詳細は [spec/notifications.md](notifications.md)）。`extractOpenChatCandidatesFromMail` はメール本文＋添付テキスト＋QR から候補を集めるだけで保存しない。`saveAndBroadcastOpenChats` は URL 空・非 https・グループ外の開催日・URL 重複・最終ラベル重複を弾いてから保存し、LINE 紐付けがあれば Flex を1通配信する（未紐付けなら保存のみ）。**保存と配信は別々に扱い、配信の失敗は保存をロールバックしない**。`broadcastOpenChats` は保存済み全件を毎回送る再配信で、`loadOpenChatBroadcastSummary` が確認ダイアログ用に配信済み回数・全件のラベル・前回配信以降に増えた行の印を返す。

### `saveEntryFormSettingsAction(values)` — `settings/entry-form/actions.ts`

会の定数6項目の保存（admin / vice_admin のみ）。空文字は「未設定」として該当キーの行を削除する。

## 既知のギャップ・未確認事項

- 定員（`capacity` / `capacityA`〜`capacityE`）は表示専用に見え、出欠登録時に定員超過を拒否する実装はコード上確認できなかった。将来的な制限予定かどうかは未確認。
- `events.kind='team'`（団体戦）を実際に選択・作成できる UI 経路は `EventForm` 内で確認できなかった（フォームは `kind` を常に `individual` 固定の hidden input で送信している）。団体戦イベントがどの経路で作られるかは未確認。
