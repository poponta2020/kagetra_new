---
status: completed
---
# 大会倍率・A級当落線推移 実装手順書

要件定義書: `docs/features/tournament-lottery-trends/requirements.md`

技術計画: `docs/features/tournament-lottery-trends/technical-plan.md`

画面設計: ユーザー判断により省略。既存シリーズ詳細とUIプリミティブを踏襲する。

## 実装タスク

### タスク1: 版管理・級別採用原本・大会区分のスキーマを追加する
- [x] 完了
- **目的:** 抽選時点の名簿、後日更新、実出場結果、級別定員、大会区分を訂正可能かつ追跡可能な形で保持する。
- **対応AC:** AC-1, AC-2, AC-4, AC-5, AC-6, AC-7
- **主な変更領域:** `packages/shared/src/schema/`、`packages/shared/drizzle/`、schema relations・schema tests。roster版管理、entry当落区分、確定名簿発表、開催回・級別fact、roster import draft、mail worker job kind、edition大会区分を含む。
- **依存タスク:** なし
- **必要なテスト:** enum・FK・部分UNIQUE・CHECK、cascade/set-null、既存roster移行、active fact一意、同一rosterの申込／確定兼用、旧データ非破壊。
- **完了条件:** migration生成・schema tests・shared typecheckが成功し、既存名簿行が保持される。
- **対応Issue:** #296

### タスク2: 名簿パーサとmaterializeを版管理・当落区分・会員自動紐づけへ対応させる
- [x] 完了
- **目的:** Excel全シートのA〜E級名簿を解析し、抽選時点を失わず保存するとともに、氏名完全一致かつ一意な会員を自動紐づけする。
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-6
- **主な変更領域:** `apps/web/src/lib/roster-import/`、`apps/web/src/lib/players/`、`apps/web/src/lib/result-import/materialize.ts`、イベント詳細の名簿取込Action・表示、対応テスト。
- **依存タスク:** タスク1
- **必要なテスト:** 複数シート・級別解析、accepted/waitlisted/rejected、抽選除外、`.xls/.xlsx/.xlsm`、重複検知、訂正版supersede、後日確定名簿併存、申込＝確定の明示兼用、一意会員一致／0件／正規化衝突、結果取込時players.user_id更新、既存名簿表示回帰。
- **完了条件:** 削除置換が版管理へ変わり、既存イベント画面は最新有効版を表示し、対象テストがgreenになる。
- **対応Issue:** #297

### タスク3: Yahoo Mail複数フォルダ取得と名簿ドラフト生成を実装する
- [x] 完了
- **目的:** INBOXと過去フォルダを冪等取得し、低コストの候補判定後に名簿原本を構造化ドラフトへ変換する。
- **対応AC:** AC-6
- **主な変更領域:** `apps/mail-worker/src/fetch/`、CLI、jobs、roster parser runner、candidate classifier、PDF/Word/本文フォールバック、`apps/mail-worker/test/`。
- **依存タスク:** タスク2
- **必要なテスト:** mailbox指定・既定INBOX、Message-ID重複、年度範囲、候補／非候補、添付／本文単位の冪等性、Excel成功、PDF/Word/画像PDF失敗分離、AI費用上限、途中失敗継続。
- **完了条件:** `99_202510以前のメール` を指定したdry-runが既存メールを変更せず候補集計を返し、worker tests・typecheckが成功する。
- **対応Issue:** #298

### タスク4: 名簿ドラフトの確認・採用・訂正フローを実装する
- [x] 完了
- **目的:** 抽出結果を開催回・級・原本用途へ安全に紐づけ、検証済みfactだけを集計対象にする。
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-6, AC-7
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/` の名簿取込Action・レビュー画面、edition検索の既存部品、roster/fact/publication materialize、結果原本置換Action、対応テスト。
- **依存タスク:** タスク3
- **必要なテスト:** admin認可、開催回・級・用途・発表日・定員・無抽選種別・申込開始日の検証、抽選statusの必須原本、定員未満検証、定員なし、訂正の旧版保持、後日更新併存、結果初回自動リンク／既存リンク明示置換、二重承認競合、revalidate。
- **完了条件:** 未確認ドラフトは一般集計へ出ず、承認・訂正が1トランザクションで版と採用原本を更新する。
- **対応Issue:** #299

### タスク5: 年度別公認大会出場回数の内部クエリを実装する
- [x] 完了
- **目的:** 公認・新春の確定名簿と実出場結果から、任意基準日時点の自会員／選手別回数と完全性を再現する。
- **対応AC:** AC-4, AC-5, AC-7
- **主な変更領域:** `apps/web/src/lib/lottery/appearance-counts.ts`、ルール・年度ヘルパー、クエリ／DBテスト。
- **依存タスク:** タスク2
- **必要なテスト:** 4月年度境界、公認／新春だけ、確定後cancelled、actual-only繰上り、重複DISTINCT、落選・辞退除外、B以下時代も加算、基準日後除外、結果訂正追随、区分不明・確定名簿不足・開催済み結果不足のincompleteと不足一覧、一括選手クエリのN+1防止。
- **完了条件:** 保存集計なしでAC-4/5の全ケースが再現され、クエリ計画が追加索引を利用する。
- **対応Issue:** #300

### タスク6: シリーズ級別倍率・定員余裕・A級当落線の集計を実装する
- [x] 完了
- **目的:** activeな採用原本だけから、A〜E級の推移点とA級積み上げデータを個人情報なしで生成する。
- **対応AC:** AC-1, AC-2, AC-3, AC-5, AC-7
- **主な変更領域:** `apps/web/src/lib/lottery/series-metrics.ts`、`apps/web/src/lib/stats/series.ts`、型・DBテスト。
- **依存タスク:** タスク4、タスク5
- **必要なテスト:** 150/100=1.50、抽選後更新で倍率不変、定員100/申込80の残り20・80%、定員なし、全体定員非使用、A〜E分離、重複・0分母・原本不足、主催者枠分離、回数層別accepted/waitlisted/rejected、定員線境界、レスポンスに氏名・ID・原本情報がないこと。
- **完了条件:** シリーズ1件を定数回のSQLで集計でき、全公開型が集計値だけを含み、対象テストがgreenになる。
- **対応Issue:** #301

### タスク7: 一般会員向けシリーズ詳細へ級別推移とA級グラフを追加する [x]
- [x] 完了
- **目的:** 既存の参加者数推移・回次一覧を維持しながら、A〜E級の需要とA級当落線を一般会員が確認できるようにする。
- **対応AC:** AC-1, AC-2, AC-3, AC-7
- **主な変更領域:** `apps/web/src/app/(app)/tournaments/series/[id]/`、`apps/web/src/components/stats/charts/`、既存Card・級UI、component/page tests。
- **依存タスク:** タスク6
- **必要なテスト:** 級切替、倍率の小数第2位、分子／分母、無抽選2種、incomplete、A級積み上げ・定員線・残り枠、空状態、個人名非表示、既存参加者数推移・回次リンク回帰、375px実画面確認。リポジトリのデザイン規約はダークモードを採用しないため、ダーク用の別表示は対象外とする。
- **完了条件:** UI testsがgreenで、AC-3を375pxの実画面で確認し、既存シリーズ機能が維持される。
- **対応Issue:** #302

### タスク8: 過去データのバックフィル、完全性レポート、正典文書を整備する
- [ ] 完了
- **目的:** 2018年以降の取得可能データを安全に段階投入でき、未取得・未確定範囲を把握できる状態にする。
- **対応AC:** AC-4, AC-5, AC-6, AC-7
- **主な変更領域:** `scripts/diagnostics/` またはmail-workerの運用CLI、`docs/data-quality/`、`docs/spec/tournaments-results.md`、`mail-worker.md`、`players.md`、`stats.md`、`events-attendance.md`、DB設計書、関連回帰テスト。
- **依存タスク:** タスク3、タスク4、タスク5、タスク6、タスク7
- **必要なテスト:** dry-run、年度／mailbox／最大件数／再開カーソル、同一入力再実行、候補・成功・要確認・失敗集計、2024年度以降の大会区分／原本coverage、全既存テスト・lint・typecheck。
- **完了条件:** INBOXと過去フォルダのdry-runレポートが再現可能で、実データ書込前の確認点が明示され、正典文書と検証コマンドが完了する。本番migration・本番バックフィルは別途明示承認後にだけ実行する。
- **対応Issue:** #303

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1
- Wave 2: タスク2（schema契約に依存）
- Wave 3: タスク3、タスク5（mail-worker／管理画面取込と、webの読取専用集計で主変更領域が直交）
- Wave 4: タスク4（タスク3のドラフト契約に依存）
- Wave 5: タスク6（採用原本と年度回数の両方に依存）
- Wave 6: タスク7
- Wave 7: タスク8

## 移行・互換性

- migrationは既存rosterを版1として保持し、削除しない。級別factや大会区分を推定で公開状態にしない。
- 現行のイベント詳細名簿、結果取込、戦績、シリーズ参加者数推移は回帰ACとして維持する。
- 新しい年度回数契約はサーバー内部のみで、既存公開APIの互換性変更はない。
- 本番DBへのmigrationと実データbackfillは実装完了とは分離し、バックアップ・dry-run・件数照合後に明示承認を得て実行する。
