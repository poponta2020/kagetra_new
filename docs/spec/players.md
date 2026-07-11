# 選手 (Players)

> **責務:** 選手（大会結果の当事者）の名寄せ・戦績集計・検索一覧・戦績詳細の閲覧、および会員アカウント（LINE ログイン）とのセルフ紐付け
> **関連画面:** `/players`（選手検索一覧）、`/players/[id]`（戦績詳細）、`/players/ranking`（選手ランキング。実装・仕様は [spec/stats.md](stats.md) が正典で、ここではリンクのみ）、`/self-identify`（会員のセルフ本人紐付け）
> **主要実装:**
> - `apps/web/src/app/(app)/players/page.tsx`（検索一覧）
> - `apps/web/src/app/(app)/players/components/PlayerSearchForm.tsx`
> - `apps/web/src/app/(app)/players/components/PlayerResultRow.tsx`
> - `apps/web/src/app/(app)/players/[id]/page.tsx`（戦績詳細）
> - `apps/web/src/app/(app)/players/[id]/scopeLabel.ts`（ランキングドリルダウンの絞り込み表示・href 組み立て）
> - `apps/web/src/app/(app)/players/[id]/BackButton.tsx`
> - `apps/web/src/app/(app)/players/[id]/SensekiTimeline.tsx`（暦年タイムライン、クライアント）
> - `apps/web/src/lib/players/queries.ts`（`searchPlayers` / `getPlayerRecord` / `getPlayerName`）
> - `apps/web/src/lib/players/placement.ts`（順位導出。materialize と単一ソース）
> - `apps/web/src/lib/players/recompute-display-name.ts`（`recomputePlayerDisplayNames`）
> - `apps/web/src/lib/players/tournamentLabel.ts`（`formatTournamentLabel` / `stripKai`）
> - `apps/web/src/lib/surname.ts`（姓抽出ユーティリティ。実際の利用箇所は `/events` の参加者チップのみ）
> - `apps/web/src/app/self-identify/page.tsx`
> - `apps/web/src/app/self-identify/actions.ts`（`claimMemberIdentity`）
> - `apps/web/src/app/self-identify/candidate-list.tsx`
> - `packages/shared/src/schema/players.ts`（`players` テーブル）

## 機能仕様

### 選手データモデルと同定ルール

`players` は「大会結果の当事者」を名寄せするグルーピング層。取込承認（materialize）時に各 `tournament_participants` を正規化キー `normalized_name`（`normalizePlayerName` による空白除去・NFKC・字体揺れ吸収後の姓名）で get-or-create し、この行に紐付ける。同定キーは**姓名のみ**で、所属会は識別に使わない（同一人物が所属表記ゆれで分裂しないため）。この結果、**同姓同名の選手は区別されない**（`project_homonym_risk_accepted` としてリスク受容済みの既知仕様）。

`players.affiliation` は常に `null` で、実データとしては使われない。表示上の所属は常に `tournament_participants`（大会ごとの生スナップショット）から取得する。`participants` が常に正であり、`players` は後から再解決・マージできるグルーピング層という役割分担（名寄せ誤りを生データを壊さず是正できる）。取込・materialize・大会マスターの詳細は [spec/tournaments-results.md](tournaments-results.md) を正典とする。

`players.userId` は会員（`users`）との紐付け用カラムとして schema に存在するが、v1 では基本 `null` のまま運用され、このカラムを実際に埋める処理は本ドメインに実装されていない（後述「本人紐付け（self-identify）」の実態と乖離がある点に注意）。

### 表示名（display_name）の再計算

`players.display_name` は「その選手の全 `tournament_participants` 横断の最頻表記（mode）」に再計算される（`recomputePlayerDisplayNames`）。`tournament_participants.name` は常に生データとして正だが、get-or-create の first-wins で確定した `display_name` は必ずしも最頻表記と一致しない（例: 大多数が「山﨑」なのに最初の取込行が「山崎」で確定してしまうケース）。

採用順は次の4段階（tiebreak を含めて完全に決定的）:

1. 出現回数（`cnt`）が最多の表記
2. `name <> normalized_name`（旧字・異体字表記、例「山﨑」「髙橋」）を優先
3. その表記が使われた最新 `event_date`
4. 表記の文字列昇順（最終 tiebreak）

Postgres の集約 `mode()` は tiebreak を制御できないため使わず、ROW_NUMBER によるランキング CTE で1件に絞る。呼び出しは `materialize.ts` から取込対象トランザクション内で、その取込で触れた `playerId` の集合にのみスコープして行われる（`playerIds` 未指定時は全 player を対象にする backfill 用途）。`playerIds` に空配列を渡すと「対象なし」として何も更新しない early-return になる（`ANY('{}')` で意図せず全件更新する事故を防ぐガード）。

### 現級・所属・最終出場の定義

選手検索一覧・戦績詳細の両方で使う概念だが、定義が微妙に異なるため区別する。

- **現級（`currentGrade`）**: 直近参加から遡って**最初に見つかる非 null な `grade`**。直近参加そのものの `grade` が `null`（級不明の大会など）でも、さらに古い参加を遡って非 null を拾う。
- **最終出場の出場級（検索一覧の `lastGrade`）**: 「絶対的直近1件」の参加における `grade`。`null` の可能性がある（現級とは別基準）。
- **直近参加の判定基準**: `event_date` 降順（`NULLS LAST`）・同日は `tournament.id` 降順。検索一覧（`searchPlayers` の LATERAL）とランキングドリルダウン絞り込み時（`opts.filter` あり）の戦績詳細ヘッダはこの明示的 ORDER BY を共有し、常に同じ1行を指す。ただし絞り込みなしの通常の戦績詳細ヘッダ（`currentGrade`/`currentAffiliation`）は `participations`（DB 取得順未規定）を JS 側でソートした結果から導出しており、同一 `event_date` の複数参加がある場合の `tournament.id` 降順タイブレークは保証されない（検索一覧と表示が食い違いうる既知のギャップ）。
- **ヘッダ所属（`currentAffiliation` / 検索一覧の `affiliation`）**: 上記「直近参加1件」の `tournament_participants.affiliation`（生スナップショット）。`players` は所属を持たないため、これが正。

ランキングからのドリルダウン絞り込み（後述）で戦績一覧が絞られても、現級・所属などの「その人が誰か」を表す識別情報は絞り込み条件の影響を受けず、常に全成績ベースで算出される。

### 順位の導出（試合結果からの機械的判定）

大会結果に含まれる自由記述の `final_rank`（例「3位」）に頼らず、級内の対戦結果（`matches`）から単純トーナメント（シングルイリミネーション）の順位を機械的に導出する（`derivePlacement` / `isDerivableClass` / `deriveClassBrackets`）。導出が一意に決まらない級（リーグ戦・順位戦・予選+本戦混在・3位決定戦・データ欠け等）は導出せず、保存済み `final_rank` にフォールバックする。

判定は2段階:

1. **級全体の導出可否判定**（`isDerivableClass`）: 非トーナメント形式を示す `roundLabel`（「リーグ」「順位」「予選」「敗者」「総当」「スイス」「位決定」を含む）が無いこと、参加者2人以上、かつ「敗北数 = 参加者数 − 1」（完全なシングルイリミネーションは優勝者以外が1回ずつ敗退するため）。リーグ戦は敗北数が大きく超過し、3位決定戦は +1 過剰、データ欠けは不足するため、いずれもここで弾かれる。
2. **個別参加者の順位導出**（`derivePlacement`）: 導出可能な級についてのみ、本人の `round` 系列の連続性・重複の有無・敗北回数（高々1回・最終試合でのみ）を検査し、勝ち残りで優勝、意味ラベル（決勝＝準優勝、準決勝＝ベスト4、準々決勝＝ベスト8）または `classMaxRound` からの round 差でベストN を確定する。級が導出可能でも、その参加者だけ0試合・round 欠けなどがあれば、その参加者のみ `null`（final_rank フォールバック）になり得る。

`labelForBracket`（`bracket` → 「優勝」「準優勝」「ベストN」の文字列）は、取込承認時に事前計算・保存される `tournament_participants.derived_bracket` からラベルを復元する側（選手検索の最終出場結果）でも共用する単一ソースであり、保存値と戦績詳細の導出値（`rankBracket`）が一致する不変条件がテストで担保されている。優勝回数・入賞回数（ベスト8以上）はこの `bracket` を基準に集計する。

### 大会名の表示ラベル

`formatTournamentLabel` は、大会シリーズの通称（`tournament_series.shortName`）があればそれを優先し、無ければ正式名称から `stripKai`（先頭の「第N回」を全角数字対応で除去）したものにフォールバックし、末尾に本人の出場級（大会全体の開催級ではない）を付す。シリーズ・通称の管理は [spec/tournaments-results.md](tournaments-results.md) を参照。

### ランキングからのドリルダウン絞り込み

`/players/ranking`（[spec/stats.md](stats.md) 正典）の各行から `?from=ranking` 付きで戦績詳細に遷移した場合のみ、`getPlayerRecord` に絞り込みオプションを渡して一覧・集計を再計算する2段構えの絞り込みを行う。

1. **①期間＋級**: ランキングと同一の `filterConds`（`lib/stats/ranking.ts`）で対象 `tournament_participants` を先に絞る。ヘッダ集計（優勝数・入賞数・活動年スパン・勝敗）はこの①母集合で算出する。
2. **②指標による一覧のみの追加絞り込み**: 指標が「優勝」なら `derived_bracket <= 1`、「入賞」なら `<= 8` の参加のみを一覧（`participations`）に表示する。ヘッダ集計は①のまま変えない（優勝大会だけで入賞数を数えたりしない）。

絞り込み解除（`?all=1`）は現在の `searchParams` を全て複製した URL で「全成績表示」に戻す。`from=ranking` とランキング側のフィルタ params は維持されるため、「← ランキングへ戻る」導線はそのまま残る。

### 本人紐付け（self-identify）

`/self-identify` は LINE ログイン済みだが内部 `users.id` にまだ紐付いていないセッションに対し、招待済み（`isInvited=true`）かつ未紐付け（`lineUserId IS NULL`）・非退会（`deactivatedAt IS NULL`）の `users` 候補一覧から本人を選ばせ、選択した `users` 行にセッションの `lineUserId` を紐付ける機能である。

**重要な注意**: この機能が実際に紐付けるのは `users`（会員アカウント）行であり、`players`（大会結果の選手）行ではない。`players.userId`（players↔users を結ぶための想定カラム）は self-identify では一切更新されない。仕様上「会員↔選手の紐付け」を想起させる名前だが、実装は「LINE アカウント↔会員アカウント」の紐付けに留まり、会員↔選手（大会成績）の紐付けは v1 では未実装（`players.userId` は基本 `null` のまま）。会員アカウント自体のロール・招待・登録の仕様は [spec/auth-admin.md](auth-admin.md) を参照。

本人性の検証は行わない（候補一覧から名前を選ぶだけで、他者確認や証跡照合はない）。招待制・身内アプリであることを前提としたリスク受容済みの割り切りである（`project_self_identify_verification_pending`）。候補一覧には氏名のみを表示し、級・所属などは開示しない。

## 画面

### 選手検索 (`/players`)

全ログインユーザーが利用可能（統計タブの一部）。クエリ `?q=` に検索語を載せ、空なら「選手名を入力して検索してください」の案内のみ表示する。検索語は `normalizePlayerName` で正規化した上で `normalized_name` の部分一致（`LIKE '%...%'`）検索を行い、最大50件を返す。ワイルドカード文字（`%` `_` `\`）はユーザー入力由来ならエスケープしてリテラル扱いする。

各行（`PlayerResultRow`）は氏名・現級・所属（1行目）、最終出場の年月＋大会名＋結果（2行目、`formatTournamentLabel` で組み立て）、出場大会数を表示する。最終出場の年月が現在年から10年以上前（`OLD_YEARS`）、または開催日不明の場合は「引退の気配」としてミュート表示にする。行タップで `/players/{id}` へ遷移する。並び順は最終出場が新しい順（`event_date` 降順 NULLS LAST）が主キー、同日グループ内では出場大会数降順→表示名昇順でタイブレークする。

### 戦績詳細 (`/players/[id]`)

`id` は正の整数でなければ `notFound()`。上部にキャリアサマリー（氏名・現級・所属・通算勝敗・勝率・チップ形式の「N大会・優勝N・入賞N・活動年スパン」）。通算勝敗は `status=normal`（通常の勝敗）の試合のみを数え、不戦勝・棄権（`walkover` / `forfeit`）は勝敗数に含めない、下部に暦年で畳めるタイムライン（`SensekiTimeline`、クライアントコンポーネント）を表示する。タイムラインは初期状態で全年が畳まれており、年見出しをタップすると展開してその年の全大会＋対戦表（回戦・相手名・枚数差・勝敗トークン）が表示される。対戦表は決勝側から1回戦側への降順。

相手名は、同一級内で `player` に解決できた場合のみ `/players/{opponentId}?from={このページのid}` へのリンクになる。未解決（生名のみ）または本人を指す解決は非リンクの通常テキストとして表示する（戦績リンクは解決済みの他者に限る、という境界がある）。

戻る導線は `?from=` の値によって3通りに分岐する: `from=ranking` ならランキングへ戻る（`router.back()` を優先し、フォールバックは絞り込み再構成 URL）、正の整数（相手名タップ由来）ならその選手の戦績詳細へ戻る、それ以外は選手検索一覧へ戻る。

ランキング由来（`?from=ranking`）でドリルダウン絞り込みが効いている間は、絞り込み条件の説明文（例「2021〜2026年・A級大会での成績（優勝した大会のみ表示）」）と「絞り込みを解除して全成績を見る」リンクを表示する。

### 選手ランキング (`/players/ranking`)

指標チップ・期間/級フィルタ・順位リストを持つ画面だが、実装・集計仕様の正典は [spec/stats.md](stats.md)。本ドメインが提供するのは、ランキング行タップ時の遷移先である戦績詳細のドリルダウン絞り込み（前述）のみ。

### 本人紐付け (`/self-identify`)

LINE ログイン済みかつ内部 `session.user.id` が未確定のセッションのみアクセスする（`session.user.id` が既にあれば `/` へリダイレクトする二重防御。通常は middleware が制御）。候補一覧（招待済み・未紐付け・非退会の `users`、氏名昇順）をクライアント側で名前フィルタしながらラジオボタンで選び、送信すると `claimMemberIdentity` が呼ばれる。エラー時は `?error=` クエリでメッセージを出し分ける（`unavailable`＝他者に先取りされた等／`duplicate`＝同一 LINE アカウントが既に別会員に紐付き済み／`invalid_input`）。

## フロー

1. 選手検索（`/players?q=...`）→ 結果行タップ → 戦績詳細（`/players/{id}`）
2. ランキング（`/players/ranking`）の行タップ → `?from=ranking&...` 付きで戦績詳細 → 絞り込み済み一覧・ヘッダを閲覧 → 「絞り込みを解除」または「← ランキングへ戻る」
3. 戦績詳細内の相手名タップ（解決済みのみ）→ `?from={元のid}` 付きで相手の戦績詳細 → 「← ○○の戦績へ戻る」で元に戻る
4. LINE 初回ログイン（未紐付け）→ middleware が `/self-identify` へ誘導 → 候補選択 → `claimMemberIdentity` が単一 UPDATE で `lineUserId` 等を確定 → セッション更新 → `/` へ redirect

## API

選手ドメインに Hono route handler は存在しない。すべて Next.js の Server Component からの直接クエリ関数、または Server Action として実装されている。

### クエリ関数（`apps/web/src/lib/players/queries.ts`。Server Action ではなく、RSC から直接呼ばれる読み取り専用関数）

- `searchPlayers(query: string)`: 選手名の部分一致検索。空クエリは空配列を返す。
- `getPlayerRecord(playerId, opts?)`: 選手の全戦績（参加大会・対戦・順位・集計値）を組み立てる。`opts.filter` / `opts.bracketAtMost` を渡すとランキングドリルダウン用の絞り込みモードになる。
- `getPlayerName(playerId)`: 戻る導線のラベル用に表示名のみを引く軽量クエリ。

### Server Action

- `claimMemberIdentity(formData)`（`apps/web/src/app/self-identify/actions.ts`）: セッションの `lineUserId` を検証 → 入力（`userId`）を zod でバリデーション → 全前提条件（未紐付け・招待済み・非退会）を1つの `UPDATE ... WHERE` に含めた単一ステートメントで紐付ける（0行更新なら他者に先取りされた等として `?error=unavailable` へ redirect）。UNIQUE 制約違反（同一 `lineUserId` の競合）は `?error=duplicate` へ。成功時は `unstable_update` でセッションの JWT を更新し、`revalidatePath('/')` の上 `/` へ redirect。明示的なロック（`FOR UPDATE` 等）ではなく、WHERE 句に全前提を詰めた単一 UPDATE の atomicity で競合を防ぐ設計。

### バッチ処理（`apps/web/src/lib/players/recompute-display-name.ts`）

- `recomputePlayerDisplayNames(db, playerIds?)`: Server Action でも route handler でもない、取込承認（materialize、[spec/tournaments-results.md](tournaments-results.md)）のトランザクション内から呼ばれる純粋な DB 操作関数。取込で新規作成・更新された `playerIds` の集合にのみスコープして `display_name` を最頻表記へ再計算する。`playerIds` 未指定時は全件対象（バックフィルスクリプト用）。
