---
name: impl_ingest_special100_localdb
description: 「特殊形式/未取込100件」をローカルrehearsal DBに反映。95件は実は投入済(excelMeta誤作動でゴミ名→シリーズ照合の偽陰性)、57件正名化UPDATE+多摩22F級手動追加+完全重複2行除去。取込不能4件。本番DB未変更
metadata: 
  node_type: memory
  type: project
  originSessionId: d1f534e8-85ad-447f-b01b-bbf4a845dc39
---

[[project_individual_coverage_audit]] が「特殊形式/未取込(要確認)」とした**100件をローカル rehearsal DB(`kagetra_rehearsal` port5433)に反映**(2026-06-26)。**本番DBは未変更**。成果物=`c:/tmp/REPORT_ingest_100.md`。

## 核心: 95/100は元々DBに在った(偽陰性)
カバレッジ調査の「未取込」は (シリーズ名,第N回) 正規化キー照合の判定。実際は **bulk取込時に Excel大会名抽出(excelMeta)が誤作動**し大会名がゴミ化していたため照合に乗らず誤計上だった。ゴミ名の型: `[file]static/xxx.xls` / `【適用範囲】…選抜大会順位戦等は対応していません`(入力テンプレ注意書き) / `選抜大会(第1回~第N回)優勝回数`(集計シート名) / `(選手権20名・D級…)`(説明文)。**選抜大会(26-34回)も対戦データは正しく投入済**(順位戦だが「対戦結果表」シートは標準パーサが取得・例:第32回 三好輝明 vs 粂原圭太郎)。

## 判定手法(地に足: 参加者集合一致)
各targetのソースExcelを再パース(`_probe.mts`が name/date/クラス/対戦/**参加者名**を出力)→ DB参加者37万件と**参加者集合の重複**で実DB行を確定。正規化キーや日付では版を取り違える(同一選手プールで30%重複は別大会を誤捕捉/同名同日重複)。

## 反映(あるべき姿)
- **正名化UPDATE 66行→57大会**: ゴミ名行を**ファイル名から一意逆引き**(`[file]static/87…`→該当大会、参加者ベスト一致は同一選手プールで誤るので不可)で正式名にUPDATE。participants/matchesは無変更。
- **手動追加1件**: 多摩初心者22 F級(`570_2014_tama_syosinsya_kekka4.xls`)。番号列が「優勝/準優勝/空欄」で標準パーサ0件→前文後 row33〜のF級表(氏名/所属＋4回戦 相手/枚数/勝敗)を自前抽出→materialize。tid1456/47名/186対戦。grade enumはA-Eのみ(F級はgrade=null・className保持)。
- **完全重複2行除去**: 653(東京都選手権16と誤命名)=655(大会18)が参加者211全一致+クラス完全同一→653削除(データは選手権級+D/E/F=開催規模的に大会18、選手権16の独立結果はHP上に無い)。812(北國80)=811重複→削除。同名でも級が相補(桑名71=AB行+CDE行 等)は重複でないので両保持。

## 結果
**96/100反映**(正名化57+既に適正名37+recovery1+手動追加1)。取込不能4=報告のみ2(シニア28/湘南認定1=入賞者一覧のみ対戦表無)+団体1(九州地区高校4)+HP重複1(東京都選手権16)。DB: tournaments1454→**1453**(追加+1,重複-2)、matches→**822,957**。残ゴミ名53件は本100件の対象外(別タスクで同手法適用可)。

スクリプト(git外c:/tmp): `_probe.mts`/`match_to_db.py`/`fix_names_v2.py`(file逆引きrename)/`build_tama22.py`/`apps/web/_add_load.mts`(materialize投入)/`build_ingest_doc.py`。ローダーは cwd=apps/web で実行(materializeの`@/`エイリアスはweb tsconfigで解決、mail-worker cwdだと失敗)。
