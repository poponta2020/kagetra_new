---
name: project_rehearsal_db_audit
description: リハDB kagetra_rehearsal の点検+是正。本体コーパス健全、PDF/Word55+special100分のゴミを是正。**2026-06-26 是正実施: A2(13/16リネーム・DUP-FULL5件dedup)/B1(徳島1457→正データ49名)/B5(外れ値null化)/B4(「総当たり」は実は重複取込→10件dedup)完了**。残=A1/B2/B3/B6/A2保留4件。引き継ぎ=C:/tmp/HANDOVER_rehearsal_unified.md
metadata: 
  node_type: memory
  type: project
  originSessionId: 1fcb7606-a715-4505-9ecf-638fdace3dea
---

ローカル `kagetra_rehearsal`(Docker `kagetra-db`/5433) を点検→**是正実施**（2026-06-26、本番未変更・dump方式で後日反映）。是正前dump=`c:/tmp/rehearsal_backup_2026-06-26.sql`、是正後=`rehearsal_corrected_2026-06-26.sql`。

## 2026-06-26 是正実施（A2/A1/B1/B5/B4＋同名区別）— 全GREEN
- **A2**=13/16適用。NEW6(選抜39/40/41→ed119/120/121・高松宮75 C/D/E→ed1117、参加者検証済)、**DUP-FULL5**(668/712/729/748=桑名70/72/73/74・790=香川14。⚠️**handover未把握の隠れ重複を発見**=全級+入賞順位ありのフル再取込がクリーンの部分集合t#85/162/225/287/299/397を100%内包→ユーザー承認でフル保持・クリーン6件削除)、768=熊本復興支援(D)。**保留4件**=706/727/746/765(同定不可・山口の教訓で推測回避)。garbage56中フル再取込dupは5件のみ・A1の46件は非包含=各々唯一データ。
- **B1**=徳島1457完全破損を原本PDF(`karuta_results/new/8670.pdf`)視覚読み→49名(DBは25名のみ)×3試合をmaterialize投入(新1512→旧1457削除→ed213付替)。対称性検証エラー0・偽player47668除去。
- **B5**=score_diff>25(1306,不可能枚差)→null・自己対戦54→opponentリンクnull・round>20は B1で解消。result/opponent_nameは保持。1503山口は1457型再パース候補(残)。
- **B4**=⚠️**ユーザー指摘で「総当たり」は誤診と判明**=実は重複取込(丸ごとN倍/統合+分割/中間シート並び替え前・非表示/エントリー重複)。除外でなく`dedup_internal.sql`(keeper最小id・対戦再割当・重複畳み・相手再解決)で10件正常化、級内重複0。初心者=3回戦固定は正常。
- **A1**=edition紐付ゴミ名46件([file]/『』結果報告)を**最寄りクリーン兄弟ベースでリネーム**(`gen_a1.py`/`a1_apply.sql`: 回次差替・分割は級サフィックス・同名は日付区別)。名前のみUPDATE・identity確定済で低リスク。1174/1180→高松宮75(A)/(B)でA2の(C/D/E)完成。検証: [file]残0/回次整合。例外=edition77にクリーン同名3件(1399B/1400C/1418E、A1対象外・要級付与は別判断)。
- **同名区別**=edition77修正を契機に**同一edition内で同名(級無)の大会が116 edition/310件**(級分割が素名共有)と判明→ユーザー承認で全区別。真の重複(同edition+同級+同日)は0=純命名。`gen_dupname.py`: 級一意→`(級)`/同級衝突→`(級・MM/DD)`/無級→`(MM/DD)`or整形類名。同edition同名=**0達成**・name-only・可逆。⚠️別途残る素名ゆれ(ed892「第 104 回」スペース/ed965全角/ed750/814/661/479の接頭尾辞)は別案件。
- 全件 display_name recompute(129更新)。最終: tournaments1502/participants368,176/matches818,595/players47,794=distinct/孤児0/edition整合/同edition同名0/score>25・自己対戦0。
- **残**: A2保留4件(706/727/746/765)・1503山口(ユーザー判断=下位級で頑張り見合わず保留継続)・素名ゆれ正規化(任意)・A3-A(名人/クイーン、保留)・B2(多摩1473/1474ラベル103行・偽47667)・B3(affiliation8件)・B6(整形)。本番投入はGO待ち。

---
（以下は点検時=是正前の記録）

**是正の統合引き継ぎ書=`C:/tmp/HANDOVER_rehearsal_unified.md`**（旧 `HANDOVER_rehearsal_audit_cleanup.md` ＋ `HANDOFF_tournament_linking.md` を一本化・旧2通は証跡として残置）、詳細レポート=`C:/tmp/REPORT_rehearsal_db_audit.md`、検証クエリ=`C:/tmp/audit_q1〜q21_*.sql`。
**2026-06-26 統合時に全数値をライブDBで独立再検証**し3点訂正(下記反映)＋[[project_tournament_series_master]] の null72リンクも統合書に集約。⚠️**最重要訂正=「削除候補」とされた16件(D集計3+E壊れ名12+768)は全て実データ約5,300人/12,300対戦を保持→リネーム。削除厳禁**(旧HANDOFFの「削除推奨/matches空のはず」は誤り)。このDBに削除すべき空レコードは無い(唯一1457のみ「再パースor削除」判断)。

## 結論
- **本体コーパス(HTML/Excel 約1,450大会)は健全**。FK整合性0孤児・dan_rank値域内・series/editions孤児0重複0・(name,date)重複10組は全て級相補分割(真重複は既除去)。過去のクリーンアップは本体に有効。
- **クリーンアップ後に追加した取込分(PDF/Word55=[[impl_ingest_pdfword_localdb]]・special100=[[impl_ingest_special100_localdb]])にゴミが残存・再混入**。クリーンアップが時系列的に捕捉できなかった分。
- 現件数=tournaments1508/classes8838/participants372,594/matches828,671/players47,784/series176/editions1176（最新メモリと一致・クリーンアップ報告値1453等は陳腐化）。

## 主な異常(是正タスク・優先度順)
- **P1 ゴミ大会名62件**(`[file]static/…`42・`【適用範囲】…`8・`…優勝回数`3・`同名の級のシート…`4・`『…』結果報告`5)。excelMeta誤作動で**名前だけ破損・データは本物**。**★46/62がedition_id紐付→series名+回次で正式名復元可**(`audit_q21`)。残16はファイル名逆引き(`fix_names_v2.py`,special100実績)。本番で会員に見えるため最優先。
- **P2 徳島第3回初段認定(id1457)丸ごと破損**: name⇄affiliation完全スワップ(25参加者)・144対戦のplayer名が全て優勝/準優勝・round最大72。再パースor削除。
- **P3 ラベル行が選手化**: 選手マスタ5件(47667優勝/47668準優勝/47824敢闘賞/47828氏名/47829所属)・参加者34行(1457/1469バンコク/1473・1474多摩)。多摩は入賞記録が壊れ(「氏名」が優勝扱い)。
- **P4 PDF/Word対戦表8大会のaffiliation不良97行**(1458北國79=ふりがな混入・埼玉/太宰府/山梨/白瀧=列ブリード)。nameは正・所属のみ是正。
- **P5 総当たり表の参加者行重複~3,119**(distinct player_id基準で再集計・旧記載2,398は数え方差。1145北國84=1976余剰/1432秋田312/842愛知154/995東京東会112)。勝敗はplayer_id集計で復元可、容認も選択肢。
- **P6 matches外れ値**: score_diff>25(不可能枚差)1,308・自己対戦54。
- **P7 整形品質(低)**: 級名`対戦結果表_`接頭辞376・dan記号ゴミ422(dan_rank無害)・final_rank人名51。

## 修正対象外(設計受容)
団体21件(全件収録指示)・外国人名寄せ分裂(姓名のみ同定限界)・`?`稀字17(復旧不能の実在個人)・対戦0件38大会(入賞者のみ)・同姓同名collision。

## 制約
本番投入はdump方式([[project_bulk_load_handover]] §4)=**リハDBを是正すれば本番に載る**(ローダ再実行不要)。是正前に再dump。是正着手もGO必須・スコープ厳守。**是正完了が本番投入の前提条件に追加**。
