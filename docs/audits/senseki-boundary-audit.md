# 戦績ドメイン境界監査（senseki-boundary、2026-07-26）

配布版からの統計・戦績ドメイン切り離し（[third-party-club-deployment-assessment.md](third-party-club-deployment-assessment.md) D-2 の決定）に先立つ、モジュール境界の実測監査。**読み取り専用調査であり、実装は未着手**。切り離しリファクタの要件定義・実装計画の一次資料として使う。

**前提となる決定（2026-07-26）**:

- 切り離す: 統計タブ4セクション（ランキング/級別人口/大会統計/大会結果）・選手検索・戦績詳細・結果取込（メール結果取込の admin UI・materialize）
- 残す: 抽選倍率・A級当落線（lottery trends）・申込名簿（entry rosters）・メール取込（triage）本体・イベント/LINE配信/会員管理のすべて
- DBスキーマ（packages/shared）は共通のまま残す（migration 系列を分岐させない）
- 方式: 本体に capability フラグ（ナビ・ルートをゲート）＋配布リポ生成時に該当ディレクトリを物理削除

---

## 1. 削除可能パスの候補リスト

### apps/web/src/app/(app)/ 配下

| パス | 概数 | 判定 | 備考 |
|---|---|---|---|
| `players/`（直下 page.tsx） | 1 | 全削除可 | 選手検索トップ |
| `players/[id]/` | 6 | 全削除可 | 戦績詳細（SensekiTimeline 他） |
| `players/components/` | 3 | 全削除可 | PlayerSearchForm / PlayerResultRow |
| `players/ranking/` | 10 | 全削除可 | ランキング |
| `tournaments/page.tsx` `actions.ts` `TournamentsHeader.*` `TournamentYearList.*` | 6 | 全削除可 | 大会結果・年別ビュー |
| `tournaments/[id]/` | 3 | 全削除可 | 大会詳細（入賞者・級クロス表） |
| `tournaments/series/page.tsx` | 1 | 全削除可 | シリーズ一覧 |
| `tournaments/series/[id]/page.tsx` `page.test.tsx` | 2 | **削除不可・改修要** | 抽選倍率(残す)と大会結果(切る)が同一ページに同居。5章参照 |
| `tournaments/series/[id]/LotteryMetricsSection.tsx` `.test.tsx` | 2 | 完全に残す | 純粋な lottery 表示コンポーネント |
| `tournaments/stats/` | 4 | 全削除可 | 大会統計 |
| `admin/mail-inbox/result-drafts/[id]/`（page + components 3件） | 4 | 全削除可 | 結果ドラフト承認UI |
| `admin/mail-inbox/mail/[id]/page.tsx` | 1 | **削除不可・改修要** | triage/roster と同居。3章参照 |
| `admin/mail-inbox/actions.ts` | 1 | **削除不可・関数単位で除去** | 2,329行中 約355行が結果取込。3章参照 |

### lib / components / e2e

| パス | 概数 | 判定 |
|---|---|---|
| `apps/web/src/lib/stats/` | 17 | 全削除可（ranking / overview / detail / series / results / tournaments / types / grade-tones 各 .ts+.test.ts） |
| `apps/web/src/lib/players/` | 9 | 8件削除可・**`member-link.ts` は移設必須**（4章） |
| `apps/web/src/lib/result-import/` | 3 | 全削除可（materialize.ts / materialize.test.ts / schema-cascade.test.ts） |
| `apps/web/src/lib/mail-history.result-import.ts` ＋ `.test.ts` | 2 | 全削除可（member-mail-search の H0。2章⑥） |
| `apps/web/src/components/stats/` | 16 | 全削除可（section-tabs / StatsPeriodFilter / GradeDots / charts 5種×2） |
| `apps/web/e2e/senseki-stats-nav.spec.ts` | 1 | 全削除可 |

**残す側（依存なしを確認済み・変更不要)**: `lib/lottery/`(5)・`lib/roster-import/`(6)・`lib/edition/`(4) は切り離し対象への依存が一切なく独立。`admin/entries/`(6)・`admin/mail-inbox/roster-drafts/`・`LotteryMetricsSection.*` も同様。

---

## 2. 切断が必要な混線ポイント（全6点）

### ① ボトムナビの統計エントリ（唯一のナビ導線）

- `apps/web/src/components/layout/bottom-nav.tsx:27-32` — `{ id:'players', label:'統計', href:'/players', matches:['/players','/tournaments'] }` の1エントリのみ。
- 設定ハブ・ダッシュボード・イベント詳細を含むリポジトリ全体（53ファイルを全数確認）に、これ以外の `/players` `/tournaments` への Link は存在しない。タブ内クロスナビは `components/stats/section-tabs.tsx:21-26`（削除対象内で完結）。
- → capability フラグで TABS 配列を条件分岐。加えて URL 直叩き対策として各対象 page.tsx 冒頭に capability チェック（`notFound()`）が必要（現状ガード無し）。

### ② `tournaments/series/[id]/page.tsx` — lottery（残す）と series 詳細（切る）の同居

- `page.tsx:6` が `@/lib/stats/series`（切る側）の `getSeriesDetail` を import。`getSeriesDetail`（`lib/stats/series.ts:134-240`）は内部で `getSeriesLotteryMetrics(seriesId)`（`series.ts:144`）を呼んで結果を再ラップしているだけ。
- **lottery 側のデータ取得（`lib/lottery/series-metrics.ts`）は lib/stats・lib/players・derived_bracket に一切依存しない自己完結モジュール**。`LotteryMetricsSection` が消費するのは `SeriesLotteryMetrics` 型のみ（`LotteryMetricsSection.tsx:11-12`）。
- 解消: page.tsx から `getSeriesLotteryMetrics` を直接呼ぶ。移設が必要な最小要素は `lib/stats/series.ts:138-142` の系列名・存在確認クエリ（`SELECT id, name, kind FROM tournament_series WHERE id = ...`）1本のみ → `lib/lottery/`（または中立モジュール）へ移設。「参加者数推移・回次一覧・優勝者」表示（`page.tsx:84-105`）は capability フラグで条件表示 or 別コンポーネントへ外出しして削除対象側に持たせる。

### ③ `lib/players/member-link.ts` — 残す側が依存する会員名寄せユーティリティ

- 全82行。内容は「正規化姓名→会員(users)の一意突合」（loadUniqueMemberNameMap / resolveUniqueMemberId / syncPlayerMemberLink / syncPlayersToUniqueMembers）で、選手検索/戦績と無関係。
- 消費元: `lib/roster-import/materialize.ts:13-17`（**残す側の中核**）と `lib/result-import/materialize.ts:14`（切る側）。
- → 中立モジュール（例: `lib/members/name-link.ts`）へ移設し、両 materialize の import パスを更新。これをしないと `lib/players/` の物理削除で roster-import が壊れる。

### ④ `admin/mail-inbox/actions.ts` — 結果系4関数の関数単位除去

同一ファイルに triage(残)・tournament_drafts承認(残)・roster_drafts承認(残)・result_drafts承認(切)が併存。除去対象:

- `triggerResultParse`（1548-1612、約65行）
- `approveResultDraft`（2040-2192、約153行）
- `replaceActualResultFact`（2193-2277、約85行）
- `rejectResultDraft`（2278-2329、約52行）
- 計約355行（全体の約15%）。除去後に dead code 化する import（`resultDrafts` / `tournamentClasses` / `materializeResultDraft`）も削除（`tournamentClasses`/`tournaments` の使用行は 2123,2125,2213,2216,2225,2229-2230 のみ＝この4関数内で完結、grep 実測済み）。
- 残す関数（触らない）: approveDraft / approveDraftUnits / completeDraft / rejectDraft / reextractDraft / linkDraftToEvent（大会案内）、dismissMail / undoTriage / triggerExtractDraft / linkMailToEvent / unlinkMailFromEvent（triage）、triggerRosterParse / approveRosterImportDraft / rejectRosterImportDraft（名簿）。

### ⑤ `admin/mail-inbox/mail/[id]/page.tsx` — 結果取込セクションのブロック除去

- 444行の1ページに3ドメインが直列: 147-154行（クエリの `with` 句に `resultDraft`(切)と `rosterImportDrafts`(残)が同居）、168-185行（`excelAttachments`(切)と `rosterSources`(残)のフィルタが隣接）、**335-405行「試合結果の取込」セクション＝丸ごと切除対象**、407-440行「大会名簿の取込」＝残す。
- → ディレクトリ削除では対応不可。335-405行のブロック削除＋147-154/168-174行のクエリ縮小という「ファイル内 diff」が必須。なお一覧側 `admin/mail-inbox/page.tsx`（371行）は結果系を一切参照しておらずクリーン。`result-drafts/[id]/` と `roster-drafts/[id]/` はルートレベルで既に分離済み。

### ⑥ `lib/mail-history.result-import.ts` — 会員向けメール履歴の H0（試合結果として取り込み）

- member-mail-search（会員向け受信メール検索）の「処理の記録」は、`result_drafts.status='approved'` のメールに「試合結果として取り込み」の行を出す。これは結果取込ドメインなので切り離し対象。
- **切除は2箇所を消すだけで完結する**（判定・文言・クエリを1関数 `loadResultImportRows` に閉じてある）:
  1. `lib/mail-history.result-import.ts` ＋ `.test.ts` をファイルごと削除
  2. `lib/mail-history.queries.ts` の `import { loadResultImportRows } from './mail-history.result-import'` 1行と、`loadHistories` 内の呼び出し1行を削除（`deriveHistory(input, extraRows)` の第2引数を落とす）
- `lib/mail-history.ts`（純関数）はこのモジュールへ一切依存しない（type-only import も含めて逆方向の依存を持たない）ため、削除でビルドは壊れない。
- 切除後の挙動: 該当メールは H0 を失って H4「対応不要として処理」に落ちるだけで、他の履歴行（H1〜H6）には影響しない。この可搬性は `mail-history.test.ts` の AC-33 テスト（`extraRows` を渡さずに `deriveHistory` を呼ぶ）が常時ガードする。
- `HistoryKind` の `'result_import'` は未使用の型メンバとして残るが実害なし（気になれば同時に消す）。

---

## 3. 共有側へ移すべきユーティリティ

- **確定: `lib/players/member-link.ts`**（2章③）。
- 移設不要と確認済み（誤検知の解消）: `event-grade-broadcast.ts` の Grade/ALL_GRADES は `@kagetra/shared/types` 由来で `lib/stats/types` 非依存。GradeDots / GRADE_TONES / formatTournamentLabel は削除対象内で完結（外部消費者なし）。`lib/edition/*` は lib/stats 非依存の独立モジュール。
- `normalizePlayerName` 等の mail-worker 側共通ヘルパーは切り離し対象外（mail-worker パッケージ自体は web にバンドルされるため配布物に残る）。roster-import からの利用も現状のままで問題なし。

---

## 4. Next.js 構造上の実現性

- 既存 route group は `(app)` の1つのみ。**切り離し対象ルート（players 全部・tournaments/page・tournaments/[id]・tournaments/series/page・tournaments/stats）を `(app)/(senseki)/...` ネストグループへ移設しても URL は不変**（/players、/tournaments、/tournaments/stats 等）。この14ファイル分は機械的移設が可能。
- **`tournaments/series/[id]/` だけは group 移設不可**（同一 URL への二重定義になる）。現行位置に残置し、2章②のデータ取得分割で対応する。
- `layout.tsx` は `(app)` 直下1本のみで統計専用の分岐は無い。ナビ非表示は bottom-nav.tsx の TABS 条件分岐で足りる。

---

## 5. 【要件定義時に確定すべき論点】editions の 'held' 遷移が消える

`tournament_series_editions.status` を `'held'` に遷移させる本番コードパスは、**`lib/result-import/materialize.ts:58-66` → `autoResolveEdition`（`lib/edition/resolve.ts:474-499`）の1経路のみ**（grep 実測。events/new・events/[id]/edit・approveDraftUnits はすべて `'unconfirmed'` 固定）。

result-import を削除した配布版では、以後どの開催回も `'held'` にならない。影響:

1. 当落線の「抽選倍率」自体（`buildCoreMetric`）は無影響（申込/抽選結果名簿＝roster-import 由来データのみで完結）。
2. 「A級当落線」の出場回数集計（`buildCutoff`）で、`missing_actual_result` の欠損警告（`status='held'` が発火条件）が**永久に発火しなくなる** — 「データ不足」と警告される代わりに静かに評価対象から外れる。
3. `actual_appearances`（大会結果由来の出場捕捉）は今後ゼロのまま。出場回数は確定名簿発表（roster-import・残す）だけに依存する。fork はそもそも結果データを持たないため名簿ベースが唯一のモードであり実害は限定的だが、名簿の取り漏れが無警告で欠損になる点は仕様として明示する必要がある。

→ 配布版の当落線を「名簿ベース集計のみ・欠損警告なし」で良しとするか、代替の注記表示を入れるかを、切り離しリファクタの要件定義で確定する。

---

## 調査方法

2026-07-26、Explore サブエージェント（読み取り専用・thorough）による実測。`/players`・`/tournaments` への参照53ファイル全数確認、mail-inbox actions.ts の関数別行範囲・import 使用行の grep 実測、'held' 遷移の全書き込み元追跡を含む。
