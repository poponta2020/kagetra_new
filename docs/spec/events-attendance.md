# イベント・出欠

> **責務:** 大会申込イベントの一覧・詳細・作成/編集・出欠回答・進行管理（申込/支払い状態のトグル）・申込進捗ボード・過去イベントアーカイブの仕様
> **関連画面:** `/events`（大会申込一覧）、`/events/new`（新規作成・管理者専用）、`/events/[id]`（詳細・出欠回答）、`/events/[id]/edit`（編集・管理者専用）、`/admin/entries`（申込管理ボード・管理者専用）、`/events-archive`（過去のイベント）、`/dashboard`（ホーム）
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

`/dashboard` はプロフィール（ロール表示）のみを表示し、イベント一覧やカウントダウン等の実データは表示していない。

## 画面

### `/events` 大会申込一覧

未来日（JST 今日以降）かつ `entryStatus != 'not_applying'` のイベントを開催日昇順で取得し、`EventListClient` に渡す。ヘッダーに「過去のイベント →」（`/events-archive`）リンクと、管理者のみ「新規作成」（`/events/new`）ボタンを表示する。0 件時は並び替え UI を出さず「現在のイベントはありません」を表示、フィルタ適用で 0 件になった場合は「申込可能な大会はありません」を表示する。

各行はイベント詳細（`/events/[id]`）へのリンクで、日付・タイトル・ステータスピル・締切カウントダウン・参加人数と参加者チップを表示する。

### `/events/new` 新規作成

管理者・副管理者のみアクセス可（それ以外は `/403` へリダイレクト）。`EventForm`（`mode="create"`）を描画し、送信時は `eventFormSchema` でバリデーション後、`resolveEditionFromForm` による edition 紐付けと `events` への insert を 1 トランザクションで行い、作成後は詳細画面へリダイレクトする。作成経路は常に `status='published'` 固定（フォームに status 入力欄自体を出さない）。

### `/events/[id]` 詳細

**罫線＋余白主導（脱カード）**の画面。カードを使うのは関連メールの1件ずつだけで、他は下線付き見出し＋余白＋ヘアライン罫線で構造を作る。運営操作は `<details>` に畳み（**既定=閉**）、既定表示では会員も管理者も「どの大会か・今どの段階か・自分は出るか」だけが見える状態にする。ルート要素は `p-4` を持ち、`<main>`（共通シェル）には padding を足さない。

上から: **固定ヘッダー**（`EventDetailHeader`。日付+大会名+会場+申込フローを1つのラッパーで sticky にする。分割するとオフセット計算が壊れる）→ **グループ日リンク**（`GroupDayLinks`。同じ申込グループ内の他の日への相互リンクを全ロールに表示。シングルトングループ（自分のみ）では非表示。sticky ヘッダーの外に置く）→ 進行管理（管理者のみ・`EventLifecycleSection`）→ 参加者（人数を見出しに出し、苗字を級の添え字つきで羅列）→ 級別定員 → 備考 → LINE 配信（管理者のみ・級別グループ配信を内包・[spec/notifications.md](notifications.md)）→ 名簿（`RosterSection`。個人戦のみ・級タブつき・[spec/tournaments-results.md](tournaments-results.md)）→ 関連メール（管理者のみ・[spec/mail-worker.md](mail-worker.md)）→ sticky な出欠トグルボタン。管理者は大会名の脇と備考見出しに「編集」リンクを持つ。

**申込フロー**（`EntryFlow` ＋ 判定は `lib/events/entry-flow.ts` の `buildEntryFlow`）は 会内締切 → 大会申込 → 抽選 → 支払 → 開催 の5ステップを横一列に描く両ビュー共通の表示で、`events.entryStatus` / `paymentStatus` が「会としての進行」を表すため会員にも同じマイルストーンを見せる。**5ステップは日付が NULL でも消さず**、日付欄に「未定」と出す（ステップ数が大会ごとに変わると横並びの目安として機能しなくなるため）。判定はハイブリッドで、大会申込は `entryStatus==='applied'`、支払は `paymentType==='advance'` かつ `paymentStatus==='paid'`、残り3つは対応する日付が JST の今日より前かで完了を決める。事前払い以外の支払と `not_applying` 時の 大会申込〜支払 は**中立**（完了・警告・現在地のいずれにもならない）。現在地は「完了でも中立でもない」最先頭の高々1つで、`not_applying` のときは出さない。警告（朱）は**期限超過かつ未完了**のときだけで、単なる未払を警告にはしない。

一般会員には 参加費・支払締切・支払方法・支払情報・申込方法 を描画しない（RSC payload にも載せない）。これらは管理者の「支払状態」「申込状態」トグル内に集約されており、会員向けの周知は LINE グループへ配信される要綱に委ねている。日付は生 ISO を出さず、文脈ごとに `9/6(日)`（見出し・フラット表）／`7/31`（申込フロー・曜日なし）／`2026/07/20 14:32`（LINE 連携状況）／`7/25 18:02`（配信履歴・名簿の発行日）を使い分ける（整形は `lib/event-date.ts`）。

出欠回答不可の会員には理由（対象外／会内締切超過／級未設定／対象外の級）をカードで示す。

### `/events/[id]/edit` 編集

管理者・副管理者のみ。既存イベントを `EventForm`（`mode="edit"`）に事前入力し、edition 紐付けの現況（`editionDefault`）も渡す。`mode="edit"` のときのみステータス選択（公開(通常)/中止/終了）を表示し、中止からの復帰は「公開(通常)」を選ぶ。更新後は詳細画面へリダイレクトする。

### `/admin/entries` 申込管理ボード

管理者・副管理者のみアクセス可（それ以外は `/403` へリダイレクト）。会レベルの申込進捗を大会単位で一望する**表示専用**画面で、状態を変える操作は持たない（変更はすべて `/events/[id]` の進行管理パネル）。ボトムナビの `申込管理` タブから入る。

母集団は「開催日が JST 今日以降」「`status != 'cancelled'`」「`kind = 'individual'`」を満たす `events` から、**非表示条件**（`entryStatus='not_applying'` ／ 基準締切が非NULLかつ超過済みで出欠「参加」0名）に該当するものを引いたもの。団体戦を外すのは確定名簿が個人戦専用の仕様で、含めると「確定名簿が永遠に出ない」大会が申込済み区画に滞留するため。

進行フェーズは**永続カラムを持たず既存列から毎回導出する**。各大会はちょうど1つの区画に入る（ライフサイクル順）:

| 区画 | 条件 | 表示・整列に使う日付 |
|---|---|---|
| 締切前 | `not_applied` かつ 基準締切がNULLまたは今日以降 | 会内締切（`COALESCE(internalDeadline, entryDeadline)`） |
| 要対応 | `not_applied` かつ 基準締切が今日より前 かつ 参加1名以上 | **本締切**（`entryDeadline`） |
| 申込済み・抽選待ち | `applied` かつ 確定名簿なし | 抽選日（`lotteryDate`） |
| 名簿確定・振込待ち | `applied` かつ 確定名簿あり かつ `paymentType='advance'` かつ `paymentStatus='unpaid'` | 支払締切（`paymentDeadline`） |
| 完了 | `applied` かつ 確定名簿あり（上記以外） | 開催日（`eventDate`） |

確定名簿ありの判定は `tournament_entry_rosters` に `rosterType='confirmed'` かつ `supersededAt IS NULL` の行が存在すること（＝メール取込フローで承認した時点）。「要対応」だけ会内締切ではなく本締切を見るのは、その区画が会内締切を既に過ぎた大会の集まりであり、行動を決めるのは主催者への申込締切だから。並び順はいずれも昇順・NULL末尾・開催日を副キー。

1大会=1行で、通称（`tournament_series.short_name`。edition 未紐付けは `title` フォールバック）+ 対象級 + 参加希望者数 `（N名）`、残日数、日付を出す。参加希望者数は `attend=true` の素通し件数で `/events` 一覧と同じセマンティクス（対象級で絞ると対象級外の表明で0名と判定され、大会が自動的に非表示になってしまうため安全側に倒している）。残日数は超過・当日・3日以内のときだけ出し、「申込済み・抽選待ち」「完了」では一切出さない。日付の種類名は各区画の見出しに1回だけ置く。

「要対応」「名簿確定・振込待ち」の2区画のみ、その区画で見ている日付が**今日以前または未設定**の大会を1件以上抱えるとき強調表示する（未設定を到来済み扱いにするのは fail-safe）。常時強調しないのは赤が背景と化して効かなくなるのを防ぐため。「締切前」区画だけ見出しタップで開閉でき（既定は開・永続化しない）、畳んでも会内締切3日以内の行は残して隠れた件数を `ほかN件` で示す。0件の区画は見出しを残して `なし` を出し、区画自体は消さない（位置が件数で動くと一目性が失われる）。母集団が0件のときだけ画面全体を空状態に差し替える。

日付判定はサーバーで確定した JST の `YYYY-MM-DD` を渡して文字列比較する（クライアントで `Date.now()` を呼ぶと hydration mismatch になる）。仕分け・並び順・日付バッジ・強調判定は `admin/entries/entry-board-utils.ts` の純関数。毎朝の `entry-overdue-alert` も「要対応」と同じ対象定義を使う（[spec/notifications.md](notifications.md)）。

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

1. 管理者が `/events/[id]` の「進行管理」→「申込状態」トグルを開いて「申込済にする」等をクリック。ボタン構成は状態で変わる: `not_applied` → 「申込済にする」＋「申し込まない」、`applied` → 「未申込に戻す」のみ、`not_applying` → 「未申込に戻す」のみ。**「申し込まない」は `not_applied` のときだけ出す** — `applied` から直接 `not_applying` へは遷移させず「未申込に戻す」を経由する2手順にして、状態機械を単純に保つ
2. LINE グループが紐付き済み（`isLineLinked`）かつ通知を伴う操作（申込済化・支払済化。取り消し方向や支払いタイプ変更は通知なし）なら、クライアントで `window.confirm` による確認を挟む。「申し込まない」は LINE 通知を伴わないが `/events` 一覧から消える不可視化を伴うため、`isLineLinked` に関係なく別文言の確認を必ず出す（解除側は確認なし）
3. `setEntryApplied` / `setPaymentPaid` が対象トランザクション内で状態を `not_applied → applied` 等の初回遷移でのみ更新し、同一トランザクションで通知 claim（`claimLifecycleNotification`）を行う。再トグルや二重呼び出しでは 2 回目以降は通知されない（once-ever）
4. コミット後、push 送信は best-effort（失敗しても状態変更はロールバックしない）
5. `revalidatePath` でイベント詳細を再検証

支払いタイプを `advance` から離れる方向へ変更すると、`paymentStatus`/`paymentPaidAt` は自動的に未払へ戻す（ただし once-ever 通知 claim ログ自体は削除しない＝再度支払済にしても完了通知は再送されない）。

**entry-groups タスク4: 同グループの複数日への一括適用。** 同じ申込グループに他の日があるとき（`groupSiblings.length > 1`）、「申込済にする」「支払済にする」「支払いタイプ」変更のいずれかを操作すると、通知確認（上記2.）の手前に**チェックボックス付き確認ダイアログ**（`GroupToggleDialog`）が挟まる。既定で該当しうる日は全チェック、`cancelled` の日はチェックボックスが disabled で選択できない（クライアント側の防御に加え、サーバー側の `setEntriesApplied` 等も tx 内で `cancelled` を再ガードして claim 対象から除外する）。確定すると選択した全 `eventId` を1回の Server Action 呼び出しにまとめ、id 昇順で各日をガード付き UPDATE → flip できた日のうち claim できた集合だけで参加者向け・会計向けそれぞれ1通に集約して push する（通知組み立ての詳細は [spec/notifications.md](notifications.md)）。単独グループ（他の日がない）では従来どおり単一 `eventId` の直接呼び出しになる。

## API（Server Actions）

### `submitAttendance(eventId, formData)` — `events/[id]/actions.ts`

ログイン必須。管理者以外は `isInvited` / 会内締切 / 対象級を再検証してからエラーを投げる（クライアント側の `canRespond` 判定をサーバーでも信頼しない）。`attend` は常に更新、`comment` は `formData` に `comment` キーが存在するときのみ更新する（トグル送信では省略されるため既存コメントを保持）。`event_attendances(eventId, userId)` の UNIQUE を使った upsert。

### `createEvent(formData)` / `updateEvent(formData)` — `events/new/page.tsx` / `events/[id]/edit/page.tsx` 内の inline server action

管理者・副管理者ガード（`session.user.role`）。`eventFormSchema.safeParse(extractEventFormData(formData))` でバリデーションし、失敗時は最初のエラーメッセージを添えて例外を投げる。対象級チェックボックス（`grade_A`〜`grade_E`）はスキーマ外で個別に読み取り、`eligibleGrades` 配列に組み立てる。`resolveEditionFromForm` による edition 解決と `events` insert/update を 1 トランザクションで行う。

### `setEntryApplied(eventId, applied)` / `setEntryNotApplying(eventId)` / `setPaymentType(eventId, type)` / `setPaymentPaid(eventId, paid)` — `events/[id]/actions.ts`

いずれも管理者・副管理者専用（`requireAdminSession()`）。`entryStatus` / `paymentType` / `paymentStatus` の更新自体はこのドメインの管轄だが、初回遷移で発火する LINE 通知の組み立て・送信ロジックは [spec/notifications.md](notifications.md) が正典。`cancelled` ステータスの大会には通知しない（状態変更自体は記録する）。

`setEntryNotApplying` は `entryStatus='not_applying'`・`entryAppliedAt=null` へ無条件 UPDATE し、通知 claim も push も行わない。`entryStatus` が `/events` 一覧の表示可否を左右するため、詳細ページに加えて `/events` も `revalidatePath` する（`setEntryApplied` の解除分岐も同様）。

### `setEntriesApplied(eventIds, applied)` / `setPaymentsPaid(eventIds, paid)` / `setPaymentTypes(eventIds, type)` — `events/[id]/actions.ts`（entry-groups タスク4）

`setEntryApplied` / `setPaymentPaid` / `setPaymentType` はそれぞれこの複数形版への薄いラッパー（`bulk([eventId], ...)`）で、単一 `eventId` を渡した場合の状態遷移・claim・文面・`revalidatePath` は従来と完全に同一。`eventIds` は重複除去して id 昇順にソートし、先頭 id から解決した `entry_group_id` を全 UPDATE の WHERE に併記する fail-closed（グループ外の id はクライアントの申告を信用せず無条件に対象から外れる）。`setEntriesApplied(ids, true)` / `setPaymentsPaid(ids, true)` は各 id をガード付き UPDATE → flip できた行のうち `cancelled` はここで再ガードして claim 対象から除外 → 種別ごとに独立 claim → **claim できた集合だけ**で参加者向け・会計向けそれぞれ1通に集約 push する（`sendClaimedNotificationBulk`、[spec/notifications.md](notifications.md)）。逆方向（`applied=false` / `paid=false`）と `setPaymentTypes` は通知を送らない。

## 既知のギャップ・未確認事項

- 定員（`capacity` / `capacityA`〜`capacityE`）は表示専用に見え、出欠登録時に定員超過を拒否する実装はコード上確認できなかった。将来的な制限予定かどうかは未確認。
- `events.kind='team'`（団体戦）を実際に選択・作成できる UI 経路は `EventForm` 内で確認できなかった（フォームは `kind` を常に `individual` 固定の hidden input で送信している）。団体戦イベントがどの経路で作られるかは未確認。
