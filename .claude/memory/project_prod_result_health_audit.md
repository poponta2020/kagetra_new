---
name: project_prod_result_health_audit
description: 本番結果データ Tier1 点検(2026-07-03) — 二重取込9ペア・構造破綻4大会・ミラー欠落/相手未解決の全数調査とマトリクス。Tier2の入力
metadata: 
  node_type: memory
  type: project
  originSessionId: 9411e216-4cbe-43f0-9441-973a3027da38
---

2026-07-03 本番DB(kagetra)を **read-only** で全数点検（Tier1=DB内部のみ、原本突合なし）。成果物を `docs/data-quality/` に格納（REPORT_本番結果データ点検 / シリーズ別年次データ有無マトリクス / class-health-metrics / suspicious-tournaments）。**再開は同ディレクトリの `HANDOVER_結果データ点検_2026-07-03.md` から**（Tier2タスクをID付きで具体化済み・合意済み運用ルール§4-5・スキル構想保留§6）。抽出SQL・分析スクリプトは `c:/tmp/dq/`（git外・このマシンのみ、成果物だけで別マシン再開可）。

**主要所見（優先順）**:
1. **二重取込 9ペア・7開催・約3,850対戦**（同一対戦の実在照合で確定）: 新春2016(D) t301↔t302 完全同一1,083 / 太宰府2019 t825↔t826・2024 t939,940↔t945 / 桑名2023 t1361↔t1370・2024 t950↔t972・2025 t1064,1065↔t1084 / 愛知2011 t21↔t643・2022 t1327↔t1328。桑名・太宰府は「1月級別→3月まとめ報告」が identity(名前+日付) dedup をすり抜けた。年2回開催(秋田/香川/鹿児島/岡山, 参加者重複51-63%)と混同しないこと
2. **構造破綻4大会**: t1458北國2017(「Ａ級」grade=null 454人に全級混合+A級64人二重) / t1462太宰府48回(A級_2/_3/_4は実体別級が全部grade=A・相互重複0) / t995東京東会2024E(ブロック消失で同round重複112) / t1216千葉2026(級名「優勝1/2/3」)
3. **ミラー欠落 6,858 (0.84%)**: 大垣3/4/5/10回に集中(ID参照形式)。⚠️**東京東会2025-11以降のA/B/D/E級と千葉2026が100%欠落=現行取込経路の問題の可能性大**（Tier2最優先）
4. **相手未解決 21,329 (2.60%)**: 兵庫18%・大垣17%・中学生選手権36%・宇佐神宮26%・千葉県67%・朝倉82%・新潟毎年7-35%
5. 勝敗矛盾146/31級・同round重複143/6級・score_diff=0×36・不戦がstatus=normal・edition年の真ズレ2件(宇佐神宮42回/桑名76回。1-5月開催の前年付けはマスター規約=仕様)

**マトリクス**: ●923セル / ○(held但しデータ無し=取込漏れ候補)136セル・**147回次** / 休33 / ・1,962。例: ちはやふる小倉山杯2021-26全欠。日付なし大会101(年はedition経由で判明、完全不明はミュンヘンのみ)・シリーズ未結線22(単発記念系)。

**手法メモ**: 接続=ssh+docker exec+`PGOPTIONS='-c default_transaction_read_only=on'`。重複判定=同一edition×同一gradeペアの参加者重複率(≥90%=重複、50-63%=年2回開催)→同一対戦(選手×相手×round)照合で確定。editionsは`tournament_series_editions`でyear列を持つ(旧メモの「日付持たない」はevent_date/venueのみ削除の意)。

**次(Tier2)**: 重複削除→構造破綻4大会再取込→直近ミラー欠落の原因究明(現行パーサ)→大垣再パース→結線改善一括再解決→矛盾個別精査→軽微一括SQL→取込漏れ147回収。修正スキル([[feedback_no_scope_creep]]配慮の指揮者+調査fork委譲ハイブリッド案)は方針合意済みだが作成保留中。関連 [[project_bulk_load_handover]] [[project_rehearsal_db_audit]] [[project_individual_coverage_audit]]

**Tier2 進捗 (2026-07-03 午後・別マシン=SSH鍵/コーパス/リハDB/会員ページ資格情報なし)**:
- **②コード調査 完了** → `docs/data-quality/DIAGNOSIS_ミラー欠落_現行取込経路_2026-07-03.md`。確定: 一括投入(_rehearse_load.mts)と現行メール経路は**同一パーサ(parseResultExcel)+同一書込器(materializeResultDraft)を共用**→現行経路でも必ず再発。ミラー行の生成・検証機構はパーサ/materializeのどこにも無い(matches=選手視点1行・両側は原本頼み)。千葉2026級名ゴミ=シート名フォールバック無検証(`className = deriveClassNameFromSheet ?? sheet.name`)。ブロック概念なし(クラス列regex `/^クラス$|^class$/i` のみ)→E級ブロック潰れ。テストfixture CHIBA_SHEET自体が非対称(未検証)。100%欠落は原本が片側形式の示唆(推測)＝**(a)パーサ改修/(b)ミラー機械生成の判定は原本突合待ち(Tier1マシン)**
- ①⑦ **SQL草案作成済**(`docs/data-quality/sql/tier2-01_dedup_delete_DRAFT.sql`/`tier2-07_minor_cleanup_DRAFT.sql`、preflight+backup+read-back込み・未適用・愛知2022は未決で除外)。修正台帳 `result-fix-ledger.md` 新設
- 原本突合・①原本確認・本番適用・⑧回収はTier1マシン(または鍵/コーパス移設後)でのみ可能

**Tier2 ①②完了 (2026-07-03 夜・Tier1マシン)**:
- **①二重取込 本番適用完了**: opus 4体並行委譲で全9ペア原本照合(残す側が消す側を完全包含・欠落0を機械実証。桑名2024の謎E1級=原本内ダミー名テンプレート「ああ あ」等、愛知2022=12/10暫定C確定版→12/11全級最終版の2段配信・「-」級の正体はA級名簿)→リハDBリハーサル全green→本番適用。**10大会削除**(t302/t825/t939/t940/t1361/t950/t1064/t1065/t21/t1327)=対戦3,872/参加1,844/級34。t1328「-」→A級化・ダミー選手5行削除・display_name再計算74人。opp_null不変(巻き添えゼロ)・残す側55行無傷。台帳#1-11・as-applied SQL=`docs/data-quality/sql/tier2-01_dedup_delete_APPLIED_2026-07-03.sql`・backup=c:/tmp/dq/tier2/bk_dedup_*_2026-07-03.csv。本番totals後: t1,484/classes8,648/parts365,604/matches815,370
- **②原因確定=(a)パーサバグ・ミラー機械生成は不要**: 勝ちマーク`◯`U+25EF(LARGE CIRCLE)がparseResultCharのwin集合(○U+25CB/〇U+3007)に無く勝ち行全skip→敗者行のみ取込。**原本は両側完備**(生reciprocity東京東会100%・千葉84-97%、非相互分は全て不戦)。決定打=受理×数がDB対戦数と完全一致+78回(U+25CB正常)/79回(U+25EF退行)の対照。千葉2026は複合: 「氏(U+3000)名」ヘッダが/氏名/不一致→W2落ちで相手名全滅+級名シート名ゴミ(本来の級はシート内見出し【…（Ａ級）】)。provenance=対象11大会全てsource_result_draft_id null=一括投入由来
- **修正PR#265**(Issue#264): U+25EF3箇所追加/isPlayerNameHeader空白除去判定/見出しセル（Ｘ級）級導出(シート名末尾数字をblock suffix化・優勝1→A1でround衝突回避)。回帰8tests追加(mail-worker409/web1113 green)。Codex 1R pass(high・35k tokens)・**ship済 merge `4430d23`(2026-07-03)**・Issue#264自動クローズ・auto-deployで現行メール経路にも反映
- **11大会再取込も完了(台帳#12)**: 旧削除→修正パーサで materialize 再実行(apps/web/_reingest11.mts)。**本番PostgresへはSSHトンネル(ssh -L 15432:127.0.0.1:5432・PWはコンテナprintenv)で直結でき、materializeをそのまま使える**(dump/restore不要)。旧t981-1216→新t1543-1553・edition手動復元(autoResolveは全件null=保守的仕様)。参加者2,347不変・対戦2,300→4,813・E14ブロック+千葉A1-A3で優勝者導出可に。リハDBは0037未適用だったのでderived_bracket列を手動追加した(以後のリハ利用時は0035以降のスキーマ差に注意)
- **残タスク**: ③構造破綻4大会(t1458/t1462/t995はパーサ課題込み)・④大垣再パース・⑤相手未解決再解決・⑥矛盾精査(+千葉3回B原本誤記2件)・⑦軽微SQL(草案済+再取込で判明の不戦status=normal 181件追加)・⑧取込漏れ147回収
