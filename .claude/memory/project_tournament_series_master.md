---
name: project_tournament_series_master
description: 大会シリーズ・マスター(tournament_series/_editions)。HP一次ソースから各個人戦の第何回〜何回開催をマスター化。**ローカルDB(5433/kagetra)に投入+検証済(176シリーズ/1171回次)**。本番はユーザーがdumpで後日。取り込み機能/seed基盤/大掛かりテストは作らない方針
metadata: 
  node_type: memory
  type: project
  originSessionId: bbc1c3ff-2e21-4a3e-a8bd-7f9ca7b85875
---

将来アプリで「大会で検索→回次一覧／申込・抽選の推移」を出す土台として、**全日本かるた協会HP一次ソース由来**で「各個人戦シリーズが2010年以降に第何回〜第何回開催されたか」を**新規DBマスターテーブル**に落とす（2026-06-26）。我々の `tournaments`(取込結果)とは独立。申込/抽選の推移は後日（アプリ側で前向きにデータ蓄積が前提＝履歴の申込/当落データは存在しない）。

## 状態 (2026-06-26 投入完了・検証合格・rehearsalへ一本化)
**結果データと同じ `kagetra_rehearsal` DB に一本化済**(docker `kagetra-db` コンテナ内)。当初 dev(`kagetra`/5433)に入れたが、対戦結果(players/tournaments/classes/participants/matches)が `kagetra_rehearsal` に在るため**そちらへ移設し dev からは削除**(2DB分散の解消)。投入は検証済 dump を restore→結果5表は完全不変(dumpが結果テーブルを非参照=無干渉を実証)+series制約(PK/FK/UNIQUE)全在+FK孤児0。**held1052のうち797(76%)が同名+回次の tournaments と対応**(残24%=held だが未取込=選抜順位戦/PDF/パース対象外でカバレッジ調査と整合・FKリンクは未設定で将来)。tournament_series **176行** / tournament_series_editions **1171行**(held**1052**/cancelled33/unconfirmed**86**)。seed CSVと差分0・年2010-2026に完全収束・回次1〜107・孤児/重複名/制約違反なし・日本語化けなし・統合/別名(27シリーズ)正。投入SQL=`c:/tmp/load_series.sql`(自己完結=CREATE TYPE 2+TABLE 2+INSERT、冒頭DROPで冪等)、生成器=`c:/tmp/gen_load_sql.py`(_seed_*.csv→SQL)。本番へは **`c:/tmp/tournament_series_dump.sql`**(ローカルDBの pg_dump + 依存enum型を前置きした自己完結dump・冒頭DROPで冪等)を `psql -f` で流す。**まっさらDBへ復元テスト合格済**(176/1171/1052-33-86/FK orphan0/enum型2)。注意=pg_dump -t は依存enum型(tournament_kind/tournament_status)を出さないので前置き必須。**手段の目的化を避ける指示=取り込み機能/再利用seed基盤/大掛かりテスト/Drizzle schema化は今回作らない**(Drizzle化はアプリで実際に使う時に後追い)。

### tournaments への紐づけ完了 (2026-06-26)
本来の鎖 **tournament_series→editions→tournaments→classes→matches** を接続。`tournaments` に **`edition_id`(nullable FK→editions, ON DELETE SET NULL)** 追加。名前から読んだ **(シリーズ,第N回) を根拠**に突合(年はマッチに使わず照合のみ・±1は多日開催/ページ年差で許容)。**1508中 1434紐づけ・74 null**。検証=**全linkedで「名前の第N回(漢数字込)≠紐づけ回次」=0**(誤紐づけゼロ実証)。held編 937が結果有/120が結果無(選抜順位戦・PDF等=カバレッジと整合)。
- 突合器の致命バグ修正: RESULT_TAILに「大会結果」が有り**シリーズ自身の『大会』を食ってた**(桑名大会結果→桑名)→除去で56件回収。NONAME42件は cid/mdl_id→harvest索引(plan.csv/new_download_index)で正式名逆引きしリンク。
- **catalog gap 5回を追加**(1171→**1176**): 中学生選手権(個人戦)25-28(2013-16,個人戦と判明)・日タイ交流バンコク10(2014)=実在したがHP調査で漏れてた回。
- **保留(要確認)**: t#1502/1503 山口第5/3回=event_date 2024-03/2023-03 異常(山口は例年12月・真の回はt#787/741でリンク済)=並行PDF取込の日付誤り疑い。t#830「第41回高校生大会」=名称汎用で確証なし。"適用範囲…シートが…"等の壊れ名~12=Excelテンプレ文がexcelMeta誤作動で大会名に化けたもの(⚠️**実大会・実データ有**=削除でなくリネーム対象。2026-06-26再検証で訂正)。名人/クイーン戦30=タイトル戦で対象外(別途)。
- 再実行可能: `match_editions.py`(突合) + NONAME逆引き + 手動分。並行セッションが tournaments 追加中なので、増えたら再突合→追加適用で拾える。**本番dumpは edition_id列+追加5回を含む現rehearsal全体**を出す必要(旧 tournament_series_dump.sql は series2表のみで不足)。
- **横展開監査 完了(2026-06-26・クリーン)**: ①全linkedで名前シリーズ=紐づけ先シリーズ 実0(例外4=手動リンクの正規化非再現で正) ②年ズレ|event-ed|≥2 = 0 ③PDF/Word取込 pdftextラベル vs 実リンク = 山口以外の誤命名なし(残flagは団体3+バンコク/日タイ番号ゆらぎのみ)。**誤命名は山口1系統だけだった**。
- **統合引き継ぎ書 `c:/tmp/HANDOVER_rehearsal_unified.md`**(旧 `HANDOFF_tournament_linking.md` ＋ リハDB点検是正 [[project_rehearsal_db_audit]] を一本化・2026-06-26)。残=**null 72件の処理**(全件=c:/tmp/_null_handoff.txt): A名人/クイーン戦30(タイトル戦・シリーズ新設するか要ユーザー判断)/B記念charity単発19/C団体3/D選抜優勝回数集計シート3/E壊れ名テンプレ文12/G t#830高校生大会41(要確認)/H番号なし4(東京白妙・多摩初心者・大学一回生・ミュンヘン)。⚠️**D・Eは「削除」でなく「リネーム」**=2026-06-26再検証で全件が実データ保持と判明(D集計3=選抜大会39/40/41回A級32人/72戦・Eテンプレ12=各127〜582人/253〜1387戦)。削除すれば実データ消失。バンコク=日タイ片寄せも保留。現在値=**1436紐づけ/72 null**(旧記載1434/74は更新)。

### 設計確定 (ユーザー合意)
- **edition に日付を持たせない方針(A)**: `event_date`/`venue` 列は**削除**。理由=1つの第N回が級ごとに別日になる(AB級7/1・CDE級8/1)ので日付は edition の属性でなく「各開催(級×日)」の属性。日付/級は将来 `tournaments`(開催×級・名+日付で1行) / `events`(申込×級) 側から引く。editions 列= id/series_id/edition_number/year/status/source_filetype/raw_name。
- **status 意味**: held=clean な開催記録あり / cancelled=その年「中止」掲載のみ / unconfirmed=①HP掲載なし(回次連番の穴80) ②COVID期「中止/延期」掲載のみで開催未確認(6)。
- **COVID年汚染を修正**: 中止年に「第N回」が載り後年実開催した回(大阪102等24件)は、year/raw を **live(中止でも延期でもない clean 出現)優先**で導出=実開催年に修正済(大阪102→2022・横浜102→2023)。中止/延期掲載のみで clean 記録が無い6回は held でなく unconfirmed に倒した(series は実HP記載があれば保持)。

## 確定テーブル設計
- **`tournament_series`**: name(正準名,unique) / aliases(text[],表記ゆれ・旧称・会場別名) / kind(enum=individual,将来団体/タイトル拡張余地) / note
- **`tournament_series_editions`**: series_id(FK) / edition_number(第N回) / year / event_date(date?,WP期2022-26は確定・静的期は後追いbackfill) / venue(?) / status(enum: held/cancelled/unconfirmed) / source_filetype(?,excel/html/pdf/none参考) / raw_name(典拠生名) / UNIQUE(series_id,edition_number)
- 「結果取込有無」は bulk 投入後に陳腐化するので静的列にせず、将来 `tournaments` と紐付けて導出。
- `unconfirmed`(HP会員頁に掲載なし80回次)は確定開催に数えず痕跡保持・既定クエリは held のみ。

## 確定キュレーション/命名ルール（ユーザー合意 2026-06-26）
- **個人戦のみ**（団体17系統・名人/クイーン戦は除外）。地方ブロック区分は**持たない**＝「XX大会」単位でグルーピング。
- **選手権系は「○○選手権」**（末尾「大会」削除・全国/全日本も外す。**全日本選手権だけ全日本を残す**＝「選手権」単独は曖昧なため）。例 女流選手権大会→女流選手権、小中学生選手権福井大会→小中学生選手権福井。
- **高松宮杯**（←高松宮記念杯近江神宮全国大会）。**椿杯**=椿多摩杯(75-77)+椿杯(78-90)統合・椿雄太郎杯(45-48)は別系列。**信州大会**=in佐久/in駒ヶ根/信州を1系列統合。**益田大会**（←人麿の里益田）。**大垣大会**（←奥の細道むすびの地）。**全日本新人選手権**（←グランドチャンピオン併記名統合）。**北日本選手権**=併記名統合(第2,6回)。
- **ねんりんピック協賛イベント（健康福祉祭…）は対象外**。ノイズ(配信URL)除外。
- 全日本大学選手権(第18-21回)は個人/団体が曖昧＝要確認(未解決)。

## 成果物（git外 c:/tmp）
- `_seed_series.csv`(**176シリーズ**) / `_seed_editions.csv`(**1171回次**:開催1058/中止33/unconfirmed80)
- `build_seed.py`(series_coverage.csv→シード,キュレーション/命名ルール実装) / `list_series.py`(レビュー一覧) / `_seed_series_review.md`
- 典拠は [[project_individual_coverage_audit]]（HP harvest完全性実証済）。

## 次
DB未変更。**define-feature→計画承認→/do-plan で実装**（schema+migration+seed+テスト+PR）。event_groups/events/tournaments への回次紐付けは将来フェーズ。
