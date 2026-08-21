---
status: completed
completed_sections: [ユーザーストーリー, 機能要件, Acceptance Criteria と Non-goals, 技術的制約・契約]
next_section: なし
design_required: false
---
# events-no-entrants 要件定義書

## 1. 概要

- **目的**: (a) ボトムナビの「イベント」タブを「大会」に改称し、一覧まわりの見出し文言を「大会」へ揃える。(b) 会内締切を過ぎたのに参加者が 1 人もいなかったために `/events` から消えた大会を、後から確認できる専用ページ `/events-no-entrants` を新設し、`/events` から遷移できるようにする。
- **背景・動機**: `/events` は `isRowVisible`（[event-list-utils.ts:99](../../../apps/web/src/app/(app)/events/event-list-utils.ts)）で「会内締切超過 かつ 自分が attend=true でない」行を隠している。参加者 0 名の大会は**全会員から見えなくなる**が、開催日が来るまでは `/events-archive`（`eventDate < today`）にも出ないため、締切から開催日までの間どこからも辿れない（開催日が過ぎれば `/events-archive` に出るので、本ページの守備範囲は**開催日前**に限る）。「あの大会、結局誰も出なかったんだっけ」を確認する手段が無い。
- あわせて、当会が扱うイベントは実質すべて競技かるたの「大会」なので、ナビと一覧まわりの呼称を「大会」に統一する。

## 2. ユーザーストーリー

- **対象ユーザー**: 会員・管理者（ゲストは対象外）
- **目的**: 会内締切を過ぎて `/events` から消えた大会のうち、「申込者が 1 人もいなかったもの」を一覧で確認したい
- **利用シナリオ**:
  1. 管理者が「先月案内が来ていた大会、うちから誰か出たっけ？」と思い `/events` を開く。締切超過で消えているため一覧に無い。
  2. 一覧末尾の「申込者なしで締切済 →」から `/events-no-entrants` へ移動し、該当大会を開催日順で確認する。
  3. 大会カードをタップすれば従来どおり大会詳細 `/events/[id]` へ入れる（そこから申込状態の操作も可能）。

## 3. 機能要件

### 3.1 画面と遷移

| 画面 | パス | 位置づけ | 変更 |
|------|------|----------|------|
| 大会一覧 | `/events` | 現行の申込一覧 | 末尾フッターに新ページへの導線を追加。文言を「大会」へ |
| **申込者なしで締切済の大会**（新規） | `/events-no-entrants` | 参加者 0 名で会内締切を過ぎた開催前の大会 | 新設 |
| 過去の大会 | `/events-archive` | 開催日が過ぎた大会 | 見出し・文言のみ「大会」へ |
| 大会詳細 | `/events/[id]` | 既存 | 変更なし |

ナビゲーション地図:

```
ボトムナビ「大会」 → /events
  /events フッター ├→ /events-archive（「過去の大会 →」）
                   ├→ /events-no-entrants（「申込者なしで締切済 →」・ゲストには出さない）
                   └→ /events/new（「新規作成」・管理者のみ・現行どおり）
  /events-no-entrants → /events（「現在の大会 →」）
  /events-no-entrants のカード → /events/[id]
  /events-archive → /events（「現在の大会 →」）
```

新ページのレイアウトは `/events-archive`（[events-archive/page.tsx](../../../apps/web/src/app/(app)/events-archive/page.tsx)）を踏襲する（見出し行＋戻りリンク、カードの縦リスト、0 件時の Card 内メッセージ）。フィルタ・ソート・月区切りなどの操作 UI は持たない。

### 3.2 掲載対象（母集団）

`/events-no-entrants` に出すのは、次を**すべて**満たす大会:

1. `eventDate >= 今日`（JST）— 開催日が過ぎたものは `/events-archive` の担当（二重掲載しない）
2. 会内締切（`internalDeadline`）が**過去**（＝ `isPastDeadline` が true）。締切未設定（NULL）・締切当日は対象外
3. 参加者（`event_attendances.attend = true`）が **0 名**
4. `entry_status <> 'not_applying'` — 管理者が明示的に「申込なし」にした大会は今回のページには載せない（Non-goals）

- 並び順: **開催日の昇順**（近い開催日が上）。同日は id 昇順で安定させる。
- 中止（`status = 'cancelled'`）の大会は上記を満たせば掲載する（カードに StatusPill で中止と出る）。
- 掲載対象は閲覧者によって変わらない（全会員が同じ一覧を見る）。

### 3.3 カードの表示項目

`/events-archive` のカードを踏襲しつつ、常に 0 になる「参加 n 名」だけを差し替える:

- 左: 大会名（1 行省略）＋「公認」Pill（`official` のとき）／ 開催日 ／ 場所（あれば）
- 右: StatusPill（開催予定・中止など）／ **「会内締切 M/D」**（`参加 0名` の代わり。締切超過が掲載理由なので締切日を出す）
- カード全体が `/events/[id]` へのリンク

0 件のとき: Card 内に「申込者なしで締切済の大会はありません」。

### 3.4 文言の統一（「イベント」→「大会」）

| 箇所 | 現行 | 変更後 |
|------|------|--------|
| ボトムナビ タブ2 | イベント | 大会 |
| `/events-archive` h1 | 過去のイベント | 過去の大会 |
| `/events-archive` 戻りリンク | 現在のイベント → | 現在の大会 → |
| `/events-archive` 0 件文言 | 過去のイベントはまだありません | 過去の大会はまだありません |
| `/events` フッターリンク | 過去のイベント → | 過去の大会 → |
| `EventListClient` 0 件文言 | 現在のイベントはありません | 現在の大会はありません |

タブの `href`（`/events`）・アクティブ判定・順序・タブ数は変えない。URL パス（`/events`・`/events-archive`）もリネームしない。

### 3.5 権限

- `/events-no-entrants` は**会員・管理者のみ**。ゲスト（`role='guest'`）は `isGuestAllowedPath` の許可リストに追加せず、middleware で `/403` へ弾かれる。
- `/events` フッターの「申込者なしで締切済 →」リンクは**ゲストには描画しない**（403 へ飛ぶ導線を見せない）。「過去の大会 →」は現行どおりゲストにも出す。

## 4. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|----------|
| AC-1 | ボトムナビの 2 番目のタブのラベルが「大会」である（isAdmin=true/false・isGuest=true のいずれでも） | auto-test |
| AC-2 | （回帰）「大会」タブの href は `/events`、`/events` と `/events/123` で active、`/events-archive` では active にならない | auto-test |
| AC-3 | （回帰）ゲストのボトムナビは「大会」「設定」の 2 タブだけ、この順序で表示される | auto-test |
| AC-4 | `/events-no-entrants` に、`eventDate >= 今日`・会内締切超過・参加者 0 名・`entry_status <> 'not_applying'` の大会だけが表示される | auto-test |
| AC-5 | 会内締切が未設定（NULL）の大会は `/events-no-entrants` に表示されない | auto-test |
| AC-6 | 参加者が 1 名以上いる締切超過の大会は `/events-no-entrants` に表示されない | auto-test |
| AC-7 | `entry_status='not_applying'` の大会は `/events-no-entrants` に表示されない | auto-test |
| AC-8 | 開催日が過去の大会は `/events-no-entrants` に表示されない（`/events-archive` の担当） | auto-test |
| AC-9 | `/events-no-entrants` の並びは開催日の昇順である | auto-test |
| AC-10 | 対象 0 件のとき「申込者なしで締切済の大会はありません」が表示される | auto-test |
| AC-11 | 各カードは 大会名・公認 Pill・開催日・場所・StatusPill・「会内締切 M/D」 を持ち、`/events/[id]` へのリンクである | auto-test |
| AC-12 | `/events` のフッターに「申込者なしで締切済 →」リンクがあり、href が `/events-no-entrants` である | auto-test |
| AC-13 | ゲストが `/events` を見たとき「申込者なしで締切済 →」リンクは描画されない（「過去の大会 →」は描画される） | auto-test |
| AC-14 | `isGuestAllowedPath('/events-no-entrants')` が false（ゲストは middleware で `/403`） | auto-test |
| AC-15 | `/events-archive` の見出しが「過去の大会」、戻りリンクが「現在の大会 →」、0 件文言が「過去の大会はまだありません」である | auto-test |
| AC-16 | `/events` フッターの archive リンク文言が「過去の大会 →」、`EventListClient` の 0 件文言が「現在の大会はありません」である | auto-test |
| AC-17 | （回帰）`/events` の可視ルール（`isRowVisible`）は変わらない — 締切超過でも自分が attend=true の行は `/events` に残る | auto-test |
| AC-18 | （回帰）参加者 0 名・締切超過の大会は `/events` には出ず `/events-no-entrants` にだけ出る（二重掲載なし） | auto-test |
| AC-19 | `/events-no-entrants/page.tsx` がページ余白規約（`p-4`）のテスト対象に登録され、規約を満たす | auto-test |
| AC-20 | 既存テスト・lint・typecheck が CI で green（回帰） | auto-test |
| AC-21 | 本番で「大会」タブと `/events-no-entrants` の導線・一覧が期待どおり出る | manual |

## 5. Non-goals

- 「イベント作成」「イベント編集」画面の見出し文言（`/events/new`・`/events/[id]/edit`）の言い換え
- 管理系画面の「イベント」文言（メール承認の「選択したイベントを登録」など）の言い換え
- URL パス `/events`・`/events-archive` のリネーム
- `entry_status='not_applying'`（管理者が明示的に見送った大会）を見る導線 — 申込グループページ側にすでに状態表示があるため、今回のページには載せない
- `/events-archive` から `/events-no-entrants` への相互リンク（導線は `/events` からのみ）
- `isRowVisible` の可視ルール自体の変更（`/events` の見え方は現状維持）
- 新ページでのフィルタ・ソート・月区切り UI、参加者名チップ
- ボトムナビのタブ構成・順序・アイコンの変更
- 「参加者 0 名で締切を迎えた」ことの通知・アラート

## 6. 技術的制約・契約

- **締切超過判定を二重定義しない**: `event-list-utils.ts` の `isPastDeadline`（`formatDeadlineCountdown` の `past` tone が唯一の真実）を新ページでも使う。SQL 側に締切比較を書き写さず、開催日以降のイベントを取得してから既存関数で絞る（未来日イベントは高々数十件で、`/events` と同じ母集団の取り方）。
- **参加者数の定義は既存と同じ**: `event_attendances.attend = true` の件数。ゲストの回答も含む（`/events`・`/events-archive` と同じセマンティクス。`page.test.tsx` の既存回帰あり）。
- **N+1 を作らない**: `/events-archive` と同じく、表示対象イベント ID にスコープした集計 1 クエリで参加者数を取る。
- **ルートは兄弟パス**（`/events/...` の配下にしない）: `bottom-nav` の `matches` はセグメント境界一致なので、`/events/no-entrants` にすると「大会」タブが光ってしまう。`/events-archive` の先例に合わせ、タブは光らせない。
- **ゲート追加は `isGuestAllowedPath` の許可リストのみで完結**（fail-closed。追加しなければ拒否される）。今回は**追加しない**ことが仕様。
- 新ページはページ余白規約テスト `apps/web/src/app/(app)/page-padding.test.ts` の `TARGET_PAGES` へ登録する。
- ドキュメント整合: `apps/web/CLAUDE.md` のルート構成に新ページを追記する。
- マイグレーション不要（スキーマ変更なし）。公開 API の契約変更なし。

## 7. 設計判断の根拠

- **母集団を「参加者 0 名」に限定した理由**: `isRowVisible` は閲覧者ごとに結果が変わる（他の会員が出る大会も自分には隠れる）。ユーザーの求めは「参加者がいないまま締切を迎えた大会」であり、これは `attend=true` が 0 件という**全会員共通**の条件で表せる。全員が同じ一覧を見られ、サーバークエリも `/events-archive` と同程度に単純になる。
- **`not_applying` を含めない理由**: `not_applying` は管理者が申込グループページで明示的に付ける終端状態で、締切をトリガーにした自動遷移ではない（呼び出し元は UI 操作のみ）。「締切を迎えたために消えた」大会とは発生要因が違い、既に申込管理側で可視化されている。
- **`design_required: false` の理由**: 視覚の契約はユーザーが「過去のイベントのページと同じ感じ」と指定済みで、`/events-archive` が既に実在する。design-screen ループを回してもクローン以上のものは出ないため省略する。差分は「参加 n 名 → 会内締切 M/D」1 点のみで、本書 §3.3 で規定する。
- **右側を「会内締切 M/D」にした理由**: 掲載対象は定義上つねに参加 0 名なので「参加 0名」は情報量がゼロ。掲載理由である締切日を出すほうが「いつ流れたのか」が分かる。
