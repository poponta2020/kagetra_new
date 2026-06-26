---
name: project_bulk_load_handover
description: 過去大会結果の本番DB投入 — **2026-06-27 本番投入 完了(GO実施)**。是正済リハDBの結果7表(series/editions含む)を dump→restore で本番(`kagetra`@Oracle東京)へ。本番=tournaments1496/matches819,703/players47,709、リハと完全一致・全整合GREEN。本番バックアップ=C:/tmp/prod_backup_before_load_2026-06-27.sql。詳細=c:/tmp/HANDOVER_bulk_load.md
metadata: 
  node_type: memory
  type: project
  originSessionId: c46027bf-8209-47b5-a303-06559f887d85
---

過去大会結果(全日本かるた協会会員ページ harvest の HTML/Excel)の本番DB投入タスク。**個人戦パース完全完了 → 是正(B2/B3/入賞者削除/素名正規化/宇都宮熊本取込=[[project_rehearsal_db_audit]])後に本番投入完了**。

## ★2026-06-27 本番投入 完了（GO実施）= DONE
- 是正済リハ `kagetra_rehearsal` の**結果7テーブルを本番 `kagetra`(Oracle Cloud東京)へ dump→restore**。**5表想定だったがユーザー指示で7表**(tournament_series/editions追加)。
- 本番に series層スキーマが無い(Drizzle非管理)ため**先に生DDL適用**(enum `tournament_kind`/`tournament_status`＋表 `tournament_series`/`tournament_series_editions`＋`tournaments.edition_id`列/FK、`C:/tmp/prod_schema_series.sql`)→**7表data-only dump(`prod_load_7tables.sql` 83MB)を single-tx(-1/ON_ERROR_STOP)でrestore**(FK安全順、identity連番はdump内setvalで自動)。
- 接続=`ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com` → `sudo docker exec -i kagetra-postgres psql`(コンテナ内ソケットでPW不要・トンネル不要)。**PW未保存**。
- **投入前フルバックアップ=`C:/tmp/prod_backup_before_load_2026-06-27.sql`(100MB・27表・保管)**。本番結果5表が空(0)・enum/series表/edition_id無を事前確認。
- **read-back=本番件数リハ完全一致**: series180/editions1236/players47,709(=distinct)/tournaments1496/classes8689/participants367,675/matches**819,703**。整合性 player_id NULL0/孤児match0/edition FK不正0/series FK不正0。edition紐付け実証。連番=max。
- ⚠️**スキーマdrift**: series層は本番生DDL=Drizzle非定義。**本番 db:migrate 運用で維持(db:push禁止)**。将来Drizzle化は別途。
- 投入数値は handover §4 の期待値(1453等)より多い=是正後の最新(1496等)。

---
（以下は投入前=パース完了時点の記録）

**詳細引き継ぎ書**: `c:/tmp/HANDOVER_bulk_load.md`（投入手順/接続/救済/見送り）＋ `c:/tmp/COVERAGE_classification.md`（取りこぼし全件の分類・理由・保留/取込判断）。

**★2026-06-26 クリーン再構築＋完全性監査 完了（リハDB kagetra_rehearsal を新スキーマで作り直し）**:
- player同定キー姓名のみ化 ship済([[impl_player_identity_name_only]] PR#172・本番反映済)を反映し再ロード。**1,454大会 / 370,613参加 / 824,220対戦 / player 47,654**（旧120,757から名寄せで激減）。**fail=0**。本番players等は0件確認済。
- **ローダ `_rehearse_load.mts` にクリーン処理を実装**（git外scratch）: ①非選手行フィルタ516行除去(級見出し/N位/決勝・準決勝ラベル/参加者数等キャプション/大会タイトル行/裸数字/#N/A。**括弧注記付き実名「加藤優奈(埼玉)」やトレ数字「中村俊介1」は保持**) ②順位ラベル救済12(所属欄に落ちた実名を氏名へ入替) ③`??`稀字復旧113(全名とスケルトン一意一致。吉/𠮷/橋/蔭/土等。**残56=中国名(李瑞?等)・末尾欠け＝ソース(かるた協会サイト)自体が稀字を??化・実字なし=復旧不可**) ④preClean(_xHHHH_/先頭記号除去) ⑤SKIP_DIAG(取りこぼし監査)。
- **完全性監査(SKIP_DIAG)**: Excel skip 110件を全件分類。大半=団体(保留)・recovery済19・入賞/報告のみ(保留)・暗号化(三原6414)・名人クイーン挑戦者決定戦(特殊・保留)。**個人の真ギャップ2件を `_extract_extra.mts` で手動抽出→recovery.jsonl(19→21件)→反映**: 愛知シニア級(671・総当たり星取表8人/25戦→既存第16回愛知に合流)・多摩第22回Ｆ級47+シニア4(570・団体は除外)。**テーブルかるた(8760)はユーザー判断で別種目=保留**。html16件=会員専用indexページ(非結果)。
- **本番投入は dump方式に変更（ユーザー提案・確実）**: ローダを本番でトンネル越し実行(§4元案)ではなく、**検証済みリハDBを `pg_dump`(players/tournaments/tournament_classes/tournament_participants/matches の5テーブル data-only)→本番空テーブルへ restore**。本番0件・スキーマ一致・数分で堅牢。dump自体を別scratchDBで件数/FK/シーケンス検証してからGO後restore。**未実施=dump作成と本番restoreは次フェーズ(GO待ち)**。**本番の結果5テーブルが空であることをユーザーが確認済(2026-06-26)**。手順詳細は `HANDOVER_bulk_load.md` §4 に具体化済(pg_dump→psql -1 restore→setval連番→read-back)。

- **★2026-06-26 players ごみ行クリーンアップ完了（上記「ゴミ0」は不完全だった→補完）= [[project_players_garbage_cleanup]]**: ローダの CLEAN パス `isHeaderJunk` は `級/回戦/順位/決勝` 等は除くが **`氏名`/`選手名` ヘッダ語を正規表現に含まず取り逃しており、団体行・1文字切れ・残?も対象外**だった。実DBに残っていたそれらを除去/整形: ヘッダ449削除・団体112削除(多摩/杉並の団体クラス、`ねんりん`個人と外国人個人は誤検出除外)・連結名36整形(京都小倉)・**1文字切れ77をExcel姓名別セルのsource再パースで完全復元**・文字化け?は21復元/17は協会HTML稀字化で復旧不能(実在個人で保持)。整合性全0。**dump 元の最終件数 = tournaments 1453 / players 47,471 / participants 369,410 / matches 822,530**(read-back 期待値)。再解決エンジン=`apps/web/_reresolve.mts`。**dump方式なのでローダ再実行による再混入は起きない**(クリーン結果がデータに焼込済)。

要点:
- **ローダー**: `apps/web/_rehearse_load.mts`（git外スクラッチ。`DATABASE_URL`切替・`DRY_RUN`/`RECOVERY_ONLY`/`TARGET`/`DIAG`スイッチ・エラーは`e.cause?.message`記録）。救済データ=`c:/tmp/recovery.jsonl`(生成=`extract_recovery.py`)。汎用位置パーサ=`c:/tmp/positional.py`。
- **本番投入手順**: SSHトンネル `ssh -i ~/.ssh/id_ed25519_oracle -L 5432:127.0.0.1:5432 ubuntu@new.hokudaicarta.com` → PWは `sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD`(保存禁止) → `DATABASE_URL="postgresql://kagetra:<PW>@localhost:5432/kagetra" tsx _rehearse_load.mts` → read-back照合。**事前に本番tournament系が空か確認**。
- **救済19大会(systematic pass)**: 兵庫全国第10-13回・大垣第12/13回・札幌第4/5回・北國83・東京都高校初段認定1/3・神奈川県選手権14・鹿児島/佐賀/福井初段認定・ミュンヘン・さがみ野38・桑名76・東京東会76。手法=calamine/ID参照/ヘッダ無し/汎用位置/結合形式/N回修正。
- **見送り確定(別スコープ・ユーザー合意 2026-06-24)**: 団体戦~74(個人戦DBモデルに乗らない=別機能)・レポート/対戦データ無~13・PDF24・暗号化1(三原6414=PW要、入手すれば msoffcrypto で復号可)。
- **fail=2 は解決済(データ/コードのバグでない)**: 真因=`deadlock detected`。`TaskStop`で死にきらないゾンビloaderプロセスが open transaction を掴み、現役runと players get-or-create で相互ロック。ゾンビ一掃後の単一クリーンランは **fail=0** で実証。**本番は単一writerなので無問題**。ただし bulk投入中にアプリ側の大会取込(approveResultDraft/mail-worker)が走ると本物の並行デッドロック有り得る→静かな時間帯に投入。投入前に `_rehearse_load` プロセス0 と pg_stat_activity 自分以外0 を確認。
- **段位(dan)カバレッジ修正 ship 済（PR #169 merge `78e4b51`, 2026-06-25）**: パーサ `parseResultExcel` が positional フォールバック/見出し無し段位列で段位を落としていたのを修正（フォールバックに段位列検出追加＋`findDanColByContent` 内容ベース回収、`danCol` null 時のみ起動＝段位列以外の列割当は不変、実コーパス933ファイルで非dan出力バイト一致を実証）。本番投入時の段位投影 **19,313→22,383件 / 107→128大会**。**残**: 救済 'classes'（兵庫全国10-12 等 ~1,361人・北國83・札幌・東京都高校）は Python `positional.py` 生成物で段位未回収＝やるなら positional.py 改修＋`recovery.jsonl` 再生成。Excel 残りは 683/8764 のみで軽微。**段位の正規化 dan_rank も ship（PR #171 merge `a2a10bf`, 2026-06-25）**＝生 dan の39異形を rank(1-10) に畳む `normalizeDan`＋値域 CHECK(migration 0027/0028)＋backfill。リハで dan_rank 19,794行/実人数7,855人。段位別検索・最高段位(max(dan_rank))が可能に。R2 codex が自前 psql 検証で非対話ハング→kill、R1対応済+実データ検証+CI green で ship。
- 並行ブランチ `feature/import-past-results` は終始無視で進めた（ユーザー指示）。**本番書込はGO必須・会員PW(naniwagata)と本番PWは保存禁止**。
- 関連: [[project_bulk_result_import_design]] [[project_karuta_member_result_source]] [[impl_result_html_parser]] [[impl_result_excel_positional]]
