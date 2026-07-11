# Tier2 ⑨ 次セッション引継ぎプロンプト（session2 末・2026-07-05）

以下をそのまま次セッションの最初の指示として貼れる。

---

本番結果データ点検 **Tier2 ⑨「欠け大会の回収＋残結線不能の最終処分」の続き**。台帳＝`docs/data-quality/result-fix-ledger.md`（#1-#26適用済・全 read-back OK）。**このマシンが Tier2 実施機**。

## 現況（着手前に必ず本番 read-only で再確認）
- 本番 totals: tournaments **1,495** / participants **368,013** / matches **821,760** / **opp_null_normal 5,285**
- read-only 経路（PW不要）: `ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com "sudo docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGCLIENTENCODING=UTF8 kagetra-postgres psql -U kagetra -d kagetra -A -F'|'" < query.sql`（日本語出力はファイルにredirectしてRead）
- 本番書込=SSHトンネル（既存トンネルが 127.0.0.1:15432 で生存中のことあり・`ExitOnForwardFailure`で再張り）: `ssh -i ~/.ssh/id_ed25519_oracle -N -L 127.0.0.1:15432:127.0.0.1:5432 ubuntu@new.hokudaicarta.com` → `DATABASE_URL=postgresql://kagetra@127.0.0.1:15432/kagetra` + `PGPASSWORD=$(ssh ... "sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD")`（保存しない）
- リハ: `postgresql://kagetra:kagetra_dev@127.0.0.1:5433/kagetra_rehearsal`（Docker kagetra-db）。session2でT1/T2/2a/t1388のテスト分が入って drift 済
- ★実行の罠: driver は `pnpm --filter @kagetra/mail-worker exec tsx ../web/_xxx.mts` で走らせるが、materialize.ts の `@/` alias 解決に **`TSX_TSCONFIG_PATH=C:/Users/popon/kagetra_new/kagetra_new/apps/web/tsconfig.json` を必ず渡す**（cwd が mail-worker になり web の tsconfig を拾わないため）
- ★長時間の本番書込は run_in_background（タイムアウトkill禁止＝台帳#21ゾンビtx教訓）。小さい backfill は foreground+300s可

## session2 で完了した分（台帳 #23-26）
- **T1** 新発見5大会 新規取込（2026 member-download 標準xlsx: 京都78/シニア38/青森3/福井79/杉並3 → t1566-1570・+1,213参加/+2,660対戦・#23）。杉並のみ「N回戦×3列」単純トーナメント形式で専用extractor
- **T2** ちはやふる小倉山杯 第2-7回（HTMLをAI読取→compact spec→materialize・t1571-1576・#24・川瀬三連覇・series完備）
- **T3** バンコク2014第10回(.doc) = 入賞者のみ・対戦データ非包含で **取込不可確定**（confirmed-dead 扱い）
- **§2-2a** t874/887/900(相手=参加者番号→seq_no backfill)＋t862米国(相手=ニックネーム→級内含有照合) = **330件解決**（#25・totals中立）
- **§2-2b-④** t1388大垣11 末尾" ."artifact backfill = **54件**（#26）
- opp_null_normal は 5,669 → **5,285**

## 次にやること（残タスク）

### A. §2-2b 名簿欠落/姓のみ 11大会 = **原本から再取込**（最重要）
session2 偵察: 「姓backfillだけでは141件しか回収できず、大半は名簿truncation/姓のみ名簿ゆえ**再取込が必要**」。**原本はユーザーが `docs/data-quality/大会結果再取得/` に格納済**（下表）。

★**実証済(2026-07-05・_t2b_parsetest.mts)**: 原本は "氏名/所属/N回戦×(相手,○,枚数)" 成績表形式で、**既存 parseResultExcel でそのまま再パース可能（新パーサ不要）**。
- 兵庫21(xlsx)=5級 **1,094名/2,280対戦・相手 2,124/2,124 全解決(未解決0)** ＝**再取込するだけで完全回収**(現DB 596名/163未解決→1,094名/0)
- 兵庫16(xlsx)=5級 932名/2,532対戦、完全名簿は取れるが**原本自体が後半ラウンド姓のみ**で1,006がexact未解決→surname resolverで補完

**再取込方針（＝ちはやふる/T1と同じmaterialize経路の再利用。ユーザー方針「無理やりパースせず読んで成形」）**:
- **Excel(xlsx)**: `readExcel`(exceljs)→`parseResultExcel`→ParsedClass[]（兵庫16/21）
- **Excel(.xls)**: libreoffice無いので **Python xlrd で grid抽出→JSON→parseResultExcel**（_t3reingest8.mts の 'grid' kind と同型・益田/神奈川/宗像/岡山/兵庫13）
- **PDF(札幌/埼玉/山梨)**: pdfplumber でダンプ→**AI直接読取で ParsedClass[] に成形**（大きすぎなければ）or pdfplumber座標再パース
- 各: 旧tournament DELETE(cascade)→materialize→**edition復元**→**残る姓のみ後半ラウンドは surname resolver `scripts/diagnostics/_t2b1_backfill.mts` で補完**（級内prefix候補→ミラー[同round・勝敗逆・枚数一致 or 相手側解決済]で一意化・曖昧null。session2でDRY検証済=141解決だが**再取込で名簿完備後に再実行すれば解決数は大幅増**）
- **兵庫21が最クリーン(未解決0)＝最初の再取込PoCに最適**

| 原本ファイル(docs/data-quality/大会結果再取得/) | tid | 大会 | 形式 | 現名簿 | メモ |
|---|--:|---|---|--:|---|
| 2019hyogo_detail.xlsx | 833 | 兵庫16 | xlsx | 911 | absent 580=級分割/構造要調査。openpyxl read_onlyでdimensions無 |
| 13thHyogoResults.xls | 1442 | 兵庫13 | xls | 556 | ほぼ完備(解決37/absent41=德永等変体字)。再取込or変体字fold |
| 25th_masuda_result.xls | 785 | 益田25 | xls | 133 | 名簿truncation(原本はA39+BⅠⅡ+CⅠⅡ+DⅠ-Ⅳ) |
| 2012masuda_minute.xls | 665 | 益田20 | xls | 48 | 名簿truncation。相手は"○＋N"表記 |
| 20111123Kanagawa.xls | 1438 | 神奈川14 | xls | 37 | 名簿truncation。'対戦結果'シート |
| 2011munakata_result.xls | 636 | 宗像35 | xls | 180 | **姓のみ名簿**(渡邉/渡辺等)→原本Ａ-Ｄ級シートにフルネーム有か要確認。★AB級はExcelに無ければ https://www.karuta.or.jp/static/member/cats/2011/member/competitions/68/results/prize_winners.html 参照 |
| 2ndOkayama.xls | 642 | 岡山2 | xls | 162 | **姓のみ名簿**(西村/西村)。'入賞者記録'でなくA/B/C/D級シートから再取込 |
| 2017sapporo_result.pdf | 1464 | 札幌1 | pdf | 196 | ②名簿欠落。相手フルネーム。A級38等の完全名簿有。pdfplumber |
| 2014_saitama_kekka_syousai.pdf | 1461 | 埼玉32 | pdf | 202 | ②。★**原本タイトル=「第23回」**＝DB名「第32回」は誤り→大会名・回次修正要(N-4確定)。全角space |
| 第21回兵庫大会詳細結果.xlsx | 1205 | 兵庫21 | xlsx | 596 | ②。'詳細結果'シート。2026開催 |
| 第２回競技かるた山梨大会（DE級）対戦結果.pdf | 1463 | 山梨2 | pdf | 68 | ②。**DE級のみ**の原本(AB C級は別途)。相手フルネーム |

- 除外: **t640 多摩初心者(西東京市)** = 相手がチーム名の団体戦混入(t788同型)→§4でnull/除外。原本不要
- Python: xlrd 2.0.2(.xls)/openpyxl(.xlsx)/pdfplumber すべて利用可。**libreofficeはローカルに無い**（.doc変換は本番hostか別手段）
- 進め方: 1大会=1tx・件数&不変量アサーション・COPY退避・リハ→本番・派生再計算・**台帳記録**。再取込はtotals(participants/matches)が動く＝毎回計測

### B. §2-2c t1459 埼玉20回（#18）
多クラス統合誤取込＋姓のみ切詰。原本フルネーム＋級分割で再取込（⑤で453件除外済）。原本URL未取得

### C. confirmed-dead クロージング（台帳へ）
ユーザー目視で確定した回収不能を台帳で closure（DB書込なし＝完全欠損は行が無い）。中身＝`docs/data-quality/大会目視確認結果.txt`: 中止16＋開催不明/結果未掲載64＋入賞集計のみ1(シニア28)＋入賞者のみ1(鹿児島選手権40)＋バンコク2014(入賞者のみ)＋未開催2026 6。メタ誤り記録: さがみ野(35回=2021中止/36回=2022)・大阪(102回A級中止/104回BC)・東大阪33(BCDE中止)・埼玉(原本第23回)

### D. §4 最終処分（このタスクの締め・全回収後）
残 opp_null_normal（現5,285＋2b/2cで増減後）を a/b/c で一括disposition。中身棚卸し=`docs/data-quality/REFERENCE_相手未解決5669件_2026-07-05.md`。(a)回収不能→null確定 / (b)大会埋めで回収済 / (c)要調査(宇佐神宮t702/t726等)。原則「誤結よりnull」

## ドライバ資産（apps/web/・scratch・未commit）
- `_t1ingest.mts`(新規大会取込・edition手動link) / `_chihaya_ingest.mts`(compact spec展開) / `_t2a_backfill.mts`(seq_no) / `_t862_backfill.mts`(nickname含有) / `_t1388_backfill.mts`(末尾punct) / `_t2b1_backfill.mts`(**surname+mirror resolver・2bの補完に再利用**) / `_t2b_probe.mts`(未解決分類) / `_prodcheck.mts`(疎通確認)
- 原本ダンプ: `C:/Users/.../scratchpad/dump_2b_originals.py`（xls/xlsx/pdf構造ダンプ）
