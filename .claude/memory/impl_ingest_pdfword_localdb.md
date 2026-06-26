---
name: impl_ingest_pdfword_localdb
description: PDF/Wordのみで未取込だった55件の個人戦をローカルDBに取込。55/55完了(対戦表有22+入賞者のみ30+団体3)。PyMuPDF/word-extractor/pdfplumberグリッド/画像目視で抽出。本番DB未変更
metadata: 
  node_type: memory
  type: project
  originSessionId: d1f534e8-85ad-447f-b01b-bbf4a845dc39
---

[[project_individual_coverage_audit]] の「PDF/Wordのみで未取込 55件30シリーズ」をローカル rehearsal DB に取込（2026-06-26）。**本番DB未変更**。成果物=`docs/調査用/分析レポート/REPORT_pdf_word_ingest.md`（git外=c:/tmp にも）。

## 結果: 55/55取込完了
- **全対戦表(matches有)22件**: 北國79/太宰府48/埼玉20,24,32/札幌1,2,6/山梨2/徳島3/沖縄1,2/山口3,5/茨城2/長野1/白瀧4,5/台湾1。
- **入賞者のみ(順位記録/matches空)30件**: 元資料が入賞者一覧のみ=対戦表が存在しない。鹿児島系/初段認定系/千葉/多摩初心者/中学生31/長崎3/バンコク/福岡/熊本/愛媛等。participants+final_rankで投入。
- **団体戦3件(暫定収録)**: 北京4/5(源平戦)・全九州沖縄1(県対抗)。チーム順位をfinal_rankで記録(matches空)。本来は個人戦DB対象外だがユーザー全件指示で収録。
- 新規 約3,450参加者/6,800対戦。DB: tournaments 1508 / participants 372,594 / matches 828,671。

## 攻略した難形式
- **番号参照/相手名参照の全日協入力シート**(沖縄2・山口3/5・茨城2): pdfplumberグリッド→マーク列軸の順序非依存抽出(`parse_grid2.py`、seq有/無両対応・最終順位列除外・固定幅ブロック)。
- **長野1**(枚差+順位+相手名リスト): 専用`parse_nagano.py`。
- **画像PDF**(台湾1・茨城3): OCRツール不在のため**PNG化(fitz)→Read toolで目視→手作り**。台湾1は対局カード形式の全対戦、茨城3は入賞者。
- バグ教訓: dedup版build で変数nmを対戦数で上書きし大会名が"165"等になった→UPDATEで修正。

## 抽出基盤(c:/tmp、git外)
- ソース: 静的PDF/docはharvest.pyがExcelのみDL→協会HP(Basic認証)から49件追加DL `karuta_results/pdfword/`。新eraはharvest済。
- テキスト: PDF=**PyMuPDF(fitz)**(CMapで日本語OK)、.doc=**word-extractor**(プロジェクト依存・UTF-16対応。antiwordはCJK不可)。`pdftext/`。
- 対戦表パーサ `parse_text.py`(トークンストリーム型・順序差両対応・不戦勝/棄権/ふりがな/所属結合対処)。**精度=札幌6/北國79がソース完全一致**。pdfplumberグリッド+`parse_positional`は版差で不安定だった。入賞者=`parse_ranking.py`+`parse_kagoshima.py`(人数/優勝/準優勝/3位表)、難物は手動`build_manual*.py`。
- 投入: `apps/web/_add_load.mts`(materializeResultDraft, name+date冪等, ADD_FILE env)。grade enumはA-Eのみ(F級等null)。cwd=apps/web(materializeの`@/`解決)。

教訓: 大会ごとにPDFレイアウトが全く異なり万能パーサは不可。テキストストリーム型+順序非依存で主要形式を吸収、番号参照/画像/団体は個別判断。「手段の目的化」回避のため難物は手動・対象外明記。
