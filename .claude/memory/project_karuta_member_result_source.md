---
name: project_karuta_member_result_source
description: 全日本かるた協会 会員ページが全対戦結果の正統ソース。2010-2021=Excel375+HTML4510, 2022-2026=member-download585、全期間harvest済(c:\tmp)。パーサ未実装
metadata: 
  node_type: memory
  type: project
  originSessionId: c46027bf-8209-47b5-a303-06559f887d85
---

過去結果一括投入([[project_bulk_result_import_design]])の**データ調達源を確定**（2026-06-21）。

## 結論
全日本かるた協会サイトの**会員ページ**が、全対戦が載った結果Excel（[[impl_tournament_results]] の parseResultExcel が食う「対戦結果表/出場者DB形式」）の正統ソース。**公開(非会員)版はPDF/HTML主体でExcelは年4件程度**＝会員版が必須。

## アクセス機構（2系統）
- **2010–2021（旧静的アーカイブ）= HTTP Basic認証**。年ページ `https://www.karuta.or.jp/static/member/cats/{year}/member/competitions@date[year]={year}.html`。各大会行の **`<td class="long_name">` のアンカー（ラベル=大会名）が結果ファイル** `competitions/NNNN/documents/*`。`<td class="info">` は案内/申込。
- **2022–2026（新WordPress cup-info）= WP-Membersフォームログイン**（`/member/` に nonce付きPOST、`wordpress_logged_in` cookie）。各大会 `/cup-info/YYYYMM/ID/`(要ログイン)の「**大会結果(詳細)**」セクション → **`/member-download/{id}/` が結果ファイルを返す**（Content-Disposition付き、xlsx/xls/pdf）。**開催日は「要項」テーブルに明記**(static より楽)。`/static/member/cats/2022/` は空スタブ・2023+は404＝静的は2021まで。**harvest済**(下記)。
- 認証情報はユーザー提供の会員アカウント（naniwagata）。**パスワードはメモリに保存しない**。robots.txt は wp-admin のみ Disallow＝クロール可。

## 取得状況
- **2010–2021 Excel = 375件 / ~64MB / 全件openOK**（独立検証済）。保存 `c:\tmp\karuta_results\{year}\`（命名 `{大会ID}_{元名}`、**git外＝実名含む**、docs/調査用と同扱い）。
- **監査で回収3件（当初372→375）★教訓**: long_name が結果ファイルを指さないパターンがある。①2013/291 選抜大会=long_name が旧host `http://cats.karuta.or.jp/.../result_show`(拡張子なし)を指し、**結果xlsがinfo欄に「大会情報案内」と誤ラベルで存在** ②2014/437 高松宮(D,E)=long_name が **`.zip`**(中にD/E結果xls 2本)。→ **long_name が result_show(旧host)/zip/拡張子なし の大会は info欄・zip内に結果Excelが隠れる**。pdf/doc/no_link は実際に非Excel(別形式)で取り逃しでない。138(名人戦)等の決勝戦は2選手のみで対戦表なし=対象外で正。
- ハーネス `c:\tmp\harvest.py`（`dry`/`get`、Basic認証、構造抽出、冪等skip、magicバイト検証）。年別索引 `c:\tmp\karuta_results\{year}_plan.csv`（category/大会名/級/day/日付セル/ext/href）＝**manifest下書きの素**。
- 年別: 2010=1(疎), 2011-2019=26〜43/年, 2020=10(コロナで中止100), 2021=48。多くが初段認定シリーズ(2021急増)。

## 結果は Excel か HTMLテーブルの排他2形式（両方とも全対戦データ）★重要訂正
- 各大会の結果は **Excel(.xls/.xlsx/.xlsm) か HTML のどちらか一方**。Excel大会に prize_winners は無い(404確認)、HTML大会に Excel は無い。
- **HTMLは「入賞者のみ」ではない**(前回の誤り)。`competitions/{cid}/results/prize_winners.html` は**入賞者タブが既定表示**なだけで、**級タブ `<li class="TabbedPanelsTab"><a href="tournaments/{tid}.html">級</a>` → 各 `tournaments/{tid}.html` に Excel と同じ全対戦表**(選手×全回戦の 相手/枚数/○×)がHTMLで入っている。級ごとに1ページ。
- 例:2017 大阪(A)=competitions/789/results/tournaments/3469.html(64名6回戦)、多摩=8級タブ(4226=A…4687=C5)。
- **だから harvest対象は Excel だけでなく HTML大会も**。2017実数: 大会行122 = Excel37 / HTML66 / PDF9 / doc5 / なし5。Excelのharvestは「全対戦の37」、HTML66は別途クロール必要(prize_winners→級タブ→tournaments/{tid}.html、要HTML表パーサ)。
- **HTML全対戦も全年harvest済（2026-06-22）= 4510クラスページ / 641大会 / 95.6MB / 0失敗 / 全件<table>+回戦**（うち5件のみ列=選手名のみ＝成績未入力でスキップ対象）。保存 `c:\tmp\karuta_results\{year}_html\{cid}_{tid}.html`、索引 `{year}_html_index.csv`(cid/大会/級/tid/行数)。ハーネス `c:\tmp\harvest_html.py {year}`（prize_winners→級タブ→各 tournaments/{tid}.html、冪等、要 {year}_plan.csv ＝先に harvest.py dry で生成）。**コーパス計 = Excel372ファイル + HTML641大会(4510級ページ)**。
- **Excel↔HTML整合性OK（実データ検証済）**: `normalizePlayerName`(apps/mail-worker/src/result-import/normalize.ts) が NFKC＋全スペース除去＋異体字畳込(髙﨑邉邊濵濱) → Excel「市川　愛」と HTML「岸田諭」を同一キーに統一。2017実証＝両ソース重複4228人が空白差を吸収して同一player解決。同一試合の二重取込なし(Excel⊥HTML=級グループ単位で排他、404確認)。分割大会(桑名: Excel C,D,E + HTML A,B)は名前+開催日でマージ。
- 48/年(2021 Excel)は「Excel掲載大会」の全数であって、結果掲載大会の全数ではない(HTMLが別にある)。構造抽出自体はファイル名一致より優秀(result名漏れ0、名前に"result"無いExcelも+5拾う)。
- **開催日はExcel内「大会報告」シート**にある（年ページの日付列は申込締切等で開催日と別物）。日付確定は計画通り後フェーズ＝人が確定。
- ユーザー手持ちの数百件コレクション（メール由来混在）と会員サイトは**互いに上位集合でない**（メール配信のみ/サイトPDFのみの大会がある）。突き合わせは要フォルダパス。
## 2022–2026 新WordPress harvest済（2026-06-23）
- **member-download = 585ファイル / 116.3MB / 0失敗**（780大会列挙、ユニーク結果585、**開催日100%取得**）。保存 `c:\tmp\karuta_results\new\{mdl_id}.{ext}`、index `new_download_index.csv`(mdl_id/型/開催日/大会名/元名/参照数)、manifest `new_2022_2026_manifest.csv`。ハーネス `c:\tmp\harvest_new.py`(列挙→manifest) + `harvest_new_dl.py`(DL、cookiejar+nonceログイン、型=magic判定、冪等)。
- 型内訳: **xlsx 434 / xls 127 / pdf 24**。Excel 561中 560 openOK、**1件 6414.xls は OLE2でxlrd読めず**(元名=三原初段認定「大会結果報告書(対戦結果含む)」、要libreoffice等で修復、bytesは保存済)。pdf24=member-downloadがPDF返却。
- 年別ユニーク: 2022=130, 2023=148, 2024=136, 2025=124, 2026=47(開催前除く)。member-download無し129(うち結果PDF 9、他は案内のみ/開催前)。
- **新systemのExcelは形式が多様**(対戦結果表 / 詳細結果 / 結果報告書+級別シート / 出場DB / ID順勝順 / 単一Sheet1対戦表 / 名人戦運営ブック等)。中身は全対戦データ、パーサは署名判定で吸収要。**注意: member-download id は1日目/2日目・級別エントリで共有**(662リンク→ユニーク585)。
- 残作業: ①**パーサ W1(HTML)＋W2(Excel positional) は ship済**（W1=[[impl_result_html_parser]] PR#167 `8c3ed1e` 実4510ページ例外0/相手解決99.9%、W2=[[impl_result_excel_positional]] PR#168 `1ac583e` 936Excel中 +122回収/回帰0/garbage0.06%）。残=**W3少数異形のみ**(団体トーナメント/順位表/挑戦者決定戦/入賞報告=誤検出ガードで除外済＝未対応で正)。②6414.xls 修復＋pdf24/PDF結果の扱い決定 ③**全コーパス**(static Excel375＋HTML4510＋new585)をパース→開催単位 manifest→[[reference_tool_output_fabrication]] 警戒で read-back。**2010–2026 全期間の結果調達は完了**。
