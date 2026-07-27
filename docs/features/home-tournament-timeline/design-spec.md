---
status: locked
slug: home-tournament-timeline
target: apps/web/src/app/(app)/dashboard/page.tsx （ルート `/dashboard`）
design_source: live
chosen_direction: 'A: 会の出場予定型'
round: 1

mock_dir: null
design_project: null

prototype_branch: design/home-tournament-timeline
prototype_base: d42b7011c31f0ada48c450c7044bd9b7874f77be
---
# ホーム（`/dashboard`）デザイン仕様（design-spec）

> `/design-screen` Path L の確定仕様。**レイアウトの正は `design-prototype.patch`**（実コードそのもの）。
> このファイルは patch から読み取れない「意図・判断・データ要件・宿題」と、実装が満たすべき忠実度チェックリストだけを書く。レイアウトを言葉で再記述しない。

## 1. 対象と狙い

- **対象画面:** `/dashboard`（ボトムナビ「ホーム」）
- **現状の不満:** 中身が「ようこそ、○○さん」＋権限カードだけのプレースホルダーで、開いても何も分からない。ボトムナビの先頭タブが常に無価値
- **狙い:** ホームを開いた瞬間に**会の顔ぶれ**——「この先どの大会に誰が出るのか」——が読めるようにする
- **主ユーザー / 主な使い方:** 会員全員。眺める用途が主。自分の行動（未回答の出欠）はアラート1行で拾う
- **`/events` との住み分け:** `/events` は**申込の締切管理**（締切カウントダウンが主役・苗字は補足）、ホームは**会の顔ぶれ**（出場者が主役・締切は未回答アラートにだけ現れる）。同じ母集団を別のレンズで見る

## 2. 採用した方向性

- **方向性:** A「会の出場予定型」。大会当日のみ最上部に今日カード、通常時は出場タイムラインが主役。あいさつ・権限カードは撤去
- **不採用案と理由（ユーザー選択）:**
  - 「自分がどうすべきか」を主役にする案 — 未回答アラートは既に1行で足りており、ホーム全体を自分専用にすると会の情報が消える
  - 「日程感（縦カレンダー）」主役案 — 日付は左レールで足りる。顔ぶれに面積を割く方が価値が高い
  - **出場者を級ごとに束ねる案** — 級見出しで縦に伸びる割に得るものが少ない。級は各チップ内の添え字で足りる（今日カードも一列で統一。当初メモの「今日カードは級別」は破棄）
  - 「直近数件＋`/events` へ誘導」案 — ホームで顔ぶれを眺め切れることを優先し、**同一画面で展開**する「もっと見る」を採用
- **視覚の正:** `design-prototype.patch`（ブランチ `design/home-tournament-timeline`・基点 `d42b7011`）
- **最終確認時の状態:** `http://localhost:3100/dashboard?state=normal|today|long|no-alert|empty`（375×812）

## 3. 視覚の正に現れない設計判断

- **初期表示4件（`INITIAL_VISIBLE_COUNT`）**: 1行の高さが出場者数で大きく変わる（4名で約90px・22名で約199px）ため件数で切るしかない。4件なら大人数が続いても未回答アラートと今日カードが画面外へ押し出されない
- **「もっと見る」は同一画面展開**: `/events` へ飛ばすと「顔ぶれを眺める」という用途が締切一覧に化ける。展開状態は永続化しない（再訪で畳む）
- **朱（accent）は未回答アラート1箇所のみ**: 「データの装飾に朱を使わない」規約に従い、朱は「自分が手を動かす必要がある」状態表示に限定する（`/events` の当日締切バッジと同じ扱い）
- **自分の強調はチップの塗りだけ**: 独立した「自分の予定」セクションは作らない。作ると同じ大会が2回出て、会の顔ぶれという主題がぼやける
- **会場（`location`）は今日カードだけ**: タイムライン行に出すと1行が3段になり顔ぶれの面積を食う。当日は「どこへ行くか」が最重要なので今日カードにだけ出す
- **人数はチップの脇ではなく行の右端**: 顔ぶれを読む前に規模が分かる。数字だけ明朝で大きく＝`/events` 一覧の人数表示と同じ語彙
- **今日カードは `Card` を使わず同じ表層クラスを手で組む**: `Card` の内側 padding は 14px 固定で、藍帯を端まで届かせられないため（`Card` の doc コメントが指示する回避法）

## 4. 使用コンポーネント

- **既存プリミティブ:** `Card` / `Pill`（確定=brand・希望=neutral）/ `SectionLabel`（action に「大会申込へ」）/ `Link`
- **既存ヘルパー:** `formatEventDate`（今日カード）/ `surname()`（チップ表示名。`/events`・イベント詳細と同一規約）
- **新規:**
  - `HomeTimeline.tsx`（`'use client'`。「もっと見る」の展開だけが state）
  - `home-timeline-types.ts`（表示 DTO）
  - `home-timeline-utils.ts`（純関数: `splitTimelineDate` / `confidenceLabel` / `alertCountdown` / `INITIAL_VISIBLE_COUNT`）
  - 出場者チップ（新規要素。姓＋級の添え字、自分は藍塗り）

## 5. 状態（state）

| 状態 | 見え方 | 確認先 |
|---|---|---|
| 通常 | アラート＋タイムライン（4件＋もっと見る） | `?state=normal` |
| 大会当日 | 最上部に今日カード。タイムラインは明日以降 | `?state=today` |
| 大人数・長い名前 | 22名・長い大会名。大会名は1行で省略記号、チップは折り返し | `?state=long` |
| アラートなし | アラート領域ごと消える（空枠を残さない） | `?state=no-alert` |
| 出場予定ゼロ | `Card` に1行「出場予定の大会はありません」 | `?state=empty` |
| 今日だけあり | 今日カード＋「この先の出場予定はありません」 | 実装後に発生（今日カードあり・upcoming 空） |

- **エラー / 不明値:** 級 `null` の会員はチップの級添え字を出さない（チップ自体は出す）。会場 `null` は今日カードの会場行ごと省略

## 6. 必要データ

**新テーブル・新カラムは不要。** 既存テーブルの再構成のみ。

- **母集団:** `/admin/entries` と同じ（`event_date >= todayInJst()` ∧ `status <> 'cancelled'` ∧ `kind = 'individual'`）。**出場者0名の大会はホームに載せない**
- **出場者「確定」（`confidence: 'confirmed'`）:** `tournament_entry_rosters` の `roster_type = 'confirmed'` ∧ `superseded_at IS NULL` の版に属する `tournament_entry_roster_entries`。名簿の帰属は event ではなく **`entry_group_id`**
  - **出場する人の定義（本仕様で確定）:** `status IN ('confirmed', 'carried_up')` かつ `selection_outcome NOT IN ('waitlisted', 'rejected')`
    - 根拠: 確定名簿の行は `roster-import/materialize.ts` の `mapEntryStatus` が必ず `status` を埋める（明示テキストが無ければ `'confirmed'`）。一方 `selection_outcome` は `unknown` のまま残ることがあり、`roster-import/adoption.ts` が `unknown` 件数を別途数えている＝**`status` を主軸、`selection_outcome` は明示的な補欠/落選の除外にのみ使う**
    - `carry_up_declined`（繰上り辞退）・`cancelled` は出場しないので除外
- **出場者「希望」（`confidence: 'hoped'`）:** 確定名簿が無いグループのフォールバック。`event_attendances.attend = true`
- **対象級外の stale 行除外:** イベント詳細 AC-26 と同じ（`users.is_invited = true` ∧ `users.grade ∈ events.eligible_grades`。`eligible_grades` が空/null なら `is_invited` のみ）
- **大会表示名:** 通称 + 対象級（`entry-board-utils.displayName` の純関数を使う。`events` → `edition` → `series` を **leftJoin**。edition 未紐付けは `events.title`）
- **未回答アラート:** 自分の級が `events.eligible_grades` に含まれる大会のうち、`COALESCE(internal_deadline, entry_deadline)` の **7日前〜締切当日**で、自分の `event_attendances` 行が**無い**もの。基準締切の早い順
- **仮データのまま確定した項目 ★実装で必ず実配線する:** `home-timeline-proto-data.ts` の全体（会員名・大会名・会場・日付すべて架空）と `page.tsx` の状態切替バー・`searchParams`。実装時に**ファイルごと削除**する

## 7. インタラクション / レスポンシブ

- **操作:** アラート行タップ → `/events/{id}`（回答フォーム）／今日カード・タイムライン行タップ → `/events/{id}`／「もっと見る」で同一画面展開／`SectionLabel` の「大会申込へ」→ `/events`
- **モバイル:** 375px 基準。全状態で `document.documentElement.scrollWidth === 375`（横スクロールなし）を実測済み。チップは `flex-wrap`、大会名は `truncate`
- **ダークモード:** この配色系（和紙×藍墨）に dark 定義は無い（`globals.css` に `prefers-color-scheme` / `.dark` なし）。ダーク検証は対象外

## 8. 忠実度チェックリスト ★実装の完了ゲート

- [ ] 画面の縦順が上から: 未回答アラート → 今日カード → 「出場予定」セクション見出し → タイムライン → もっと見る。アラート・今日カードは**該当が無ければ枠ごと消える**（空枠・プレースホルダーを置かない）
- [ ] タイムライン行の構造が「左に日付レール（M/D を明朝太字・下に曜日1文字）／右に 大会名 → 確定/希望ピル → （右端）人数」で、その下段に出場者チップ
- [ ] 出場者チップは**級で束ねず一列**。チップ表示名は `surname()` の姓のみで、級は同じチップ内の小さな添え字（`font-mono`）。今日カードも同じ一列
- [ ] 自分のチップだけ `bg-brand` ＋ `text-ink-on-brand` ＋ 太字。それ以外は `bg-surface-alt` ＋ `border-border-soft` ＋ `text-ink-2`。チップ内の級添え字は非自分側で `text-neutral-fg`（`text-ink-meta` は surface-alt 上で 4.16:1 でコントラスト不足）
- [ ] 確度ピルは 確定=`tone="brand"` / 希望=`tone="neutral"`。独自色を作らない
- [ ] 朱（`accent` 系トークン）を使うのは未回答アラート行だけ。タイムライン・今日カード・チップに朱を使わない
- [ ] 今日カードは藍帯（`bg-brand`）がカード左右端まで届き、その中に「本日」＋`formatEventDate` の日付。会場は `location` があるときだけ大会名の下に出る
- [ ] タイムラインは初期4件（`INITIAL_VISIBLE_COUNT`）＋「もっと見る（残りN件）」。展開は同一画面内で、`/events` へ遷移しない
- [ ] 空状態は `Card` 内1行のテキストのみ（イラスト・アイコン・追加の枠線なし）。「出場予定ゼロ」と「今日だけあり・この先ゼロ」で文言が異なる
- [ ] 375px で `document.documentElement.scrollWidth === 375`（全状態）。大会名は1行で省略記号、出場者チップは折り返す
- [ ] `git grep -n "DESIGN-PROTO"` が 0 件

## 9. ガードレール準拠メモ

- 色・radius・フォントはすべて既存トークン（`globals.css` の `@theme`）。**実効値を計算済みスタイルで検算済み**（15トークン。Tailwind v4 が未定義トークンを無言で握り潰す既知の罠への対策）
- 絵文字はゼロ（データ装飾に使わない規約）。矢印は `›`（`aria-hidden`）1箇所のみ
- 日付表記は既存ヘルパー（`formatEventDate` = `M/D(曜)`）と、タイムラインレール用に2行へ割る `splitTimelineDate`。独自フォーマットを増やしていない
- 新規トークンの追加は無し

## 10. 残課題・実装への申し送り

- **DESIGN-PROTO スタブ一覧（実装時に全て消す）:**
  - `home-timeline-proto-data.ts` — ファイルごと削除
  - `page.tsx` — `searchParams`・状態切替バー・`loadHomeTimeline` 呼び出しを実クエリへ置換
  - `HomeTimeline.tsx` / `home-timeline-types.ts` / `home-timeline-utils.ts` は**マーカー無し＝そのまま本番コード**
- **`Date.now()` を呼ばない**: `todayStr` はサーバーが `todayInJst()` で渡す（hydration mismatch 回避。`event-list-utils.ts`・`entry-board-utils.ts` と同じ方針）
- **クエリ本数**: 母集団は数十件規模。`/admin/entries` と同じく本数を固定して組む（イベントごとにクエリを投げない）
- **テスト**: `home-timeline-utils.ts` の純関数と、`HomeTimeline.tsx` の状態分岐（空・もっと見る展開・自分ハイライト）に単体テストを付ける。既存 `dashboard/page.test.tsx` があれば置き換える
- **patch の適用**: `git apply --check` が `d42b7011` 時点の main で通ることを確認済み。main が進んで衝突した場合は patch を読んで手動移植する（対象は `dashboard/` 配下の新規4ファイル＋`page.tsx` 差し替えのみで、既存共通コードには触れていない）
- **性能・見え方の観測結果**: 22名の行は約199px。初期4件でも大人数が続くとタイムラインだけで800px 近くなる。運用で邪魔になったら「チップを12件で打ち切って +N」を追加する余地を残す（今回は入れない）

## 11. 要件への宿題（→ `/define-feature`）

なし（`/implement` へ直行してよい）。

- 確定名簿の「出場する人」の定義は §6 でコード上の実態（`materialize.ts` の `mapEntryStatus`・`adoption.ts` の `unknown` 扱い）を根拠に確定させた
- 本仕様のスコープ外（当初メモどおり）: 結果ダイジェスト（自会成績）・団体戦（`kind='team'`）・当落速報・補欠/落選のホーム表示
