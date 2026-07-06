# Tier2 ⑨ 次セッション引継ぎプロンプト（session4末・2026-07-06）

以下をそのまま次セッションの最初の指示として貼れる。

---

本番結果データ点検 **Tier2 ⑨「欠け大会の回収＋残結線不能の最終処分」の続き（(a)確定null受容フェーズ）**。台帳＝`docs/data-quality/result-fix-ledger.md`（#1-#44適用済・全 read-back OK）。**このマシンが Tier2 実施機**。

## 現況（着手前に必ず本番 read-only で再確認）
- 本番 totals: tournaments **1,495** / participants **368,481** / matches **823,504** / **opp_null_normal 2,233**（with_name 1,551 ＋ N0 682）
- read-only 経路（PW不要）: `ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com "sudo docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGCLIENTENCODING=UTF8 kagetra-postgres psql -U kagetra -d kagetra -A -F'|'" < query.sql`（日本語出力はファイルにredirectしてRead）
- 本番書込=SSHトンネル（`ssh -i ~/.ssh/id_ed25519_oracle -N -L 127.0.0.1:15432:127.0.0.1:5432 -o ExitOnForwardFailure=yes ubuntu@new.hokudaicarta.com` → `DATABASE_URL=postgresql://kagetra@127.0.0.1:15432/kagetra` + `PGPASSWORD=$(ssh ... "sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD")`。**使い終わったら確実に閉じる**（今回 `pkill -f "ssh.*15432"` だけでは閉じきらず `taskkill //F //PID <pid>` が必要だった。`tasklist //FI "IMAGENAME eq ssh.exe"` でPID確認）
- リハ: `postgresql://kagetra:kagetra_dev@127.0.0.1:5433/kagetra_rehearsal`（Docker kagetra-db）。**drift状態**（session3で兵庫16/21・益田25/20・神奈川14・兵庫13・札幌1・埼玉32・山梨2、session4でt851/t1299/t928/t1145/t925/t1031/t1025/t1137/t1123のテスト分が入っている。tid不一致時はtournaments行を`OVERRIDING SYSTEM VALUE`で手動INSERTしてから検証する手も使った。機構テスト目的なら drift のまま ROLLBACK 前提で使ってよい）
- ★実行の罠: driver は `pnpm --filter @kagetra/mail-worker exec tsx ../web/_xxx.mts` で走らせるが、materialize.ts の `@/` alias 解決に **`TSX_TSCONFIG_PATH=C:/Users/popon/kagetra_new/kagetra_new/apps/web/tsconfig.json` を必ず渡す**
- ★長時間の本番書込は run_in_background（タイムアウトkill禁止＝台帳#21・#27ゾンビtx教訓）
- ★materializeResultDraft等 `apps/web/src/lib/**` の内部モジュールをスクリプトから直接importするとCJS/ESM interopで`default`ラップされることがある（`(mod as {default?}).default ?? mod`パターンで対処）

## session4で完了した分（台帳 #39-44）

### A/B（記録整理のみ・DB書込なし）
- **#39**: 埼玉20回(t1459・原本URL未取得で回収不能扱い) + confirmed-dead(回収不能82・未開催2026年6・バンコク2014) + メタ誤り3件(さがみ野/大阪/東大阪33)を確定クローズ。詳細は台帳末尾「⑨§B確定クローズ一覧」。
- **#43**: t640多摩初心者(西東京市・72件)。相手が全て「聖徳B/南多摩」等のチーム名(団体戦形式)と再確認し、2b_原本URL依頼文書の既存判定(原本URL不要)を追認してクローズ。

### C（残opp_nullの仕分け直し）
- 新レポート `docs/data-quality/REFERENCE_相手未解決3868件_2026-07-06.md`（作成時点3,868件のスナップショット。以降の適用で現在値2,233まで減少・UPDATE注記あり）。

### D（兵庫16型再発監査）
- 級単位opp_null≥40%スクリーニングで新規隠れ級ゼロと結論（検出=千葉/鳥取/埼玉20/フランス/福井中学のみ、いずれも既知）。

### (c) 姓のみ異体字ミラーbackfill（totals中立relink・実質完了）
- **#40**: 宇佐神宮t702/t726で242件relink（異体字fold＋姓＋名頭文字＋mirror必須ゲート）。
- **#41**: 同型5大会（兵庫15/大分46/桑名69/香川9/朝倉4）へ横展開・321件relink。
- 合計563件relink。残る候補は原本誤記等で意図的null維持済み。

### (b) 原本再取込（9大会・全て100%または99.8%解決という驚異的な成果）
- **#42**: 千葉9回t851(2019)・鳥取2回t1299(2022)・鳥取3回t928(2023)。真因=**既存parseResultExcelが「相手欄No+氏名2列見出し」をroundとして誤認識し水増しするバグ**。専用抽出器(`_expand2_extract2.mts`/`_expand2_reingest.mts`)で千葉99.8%・鳥取2大会100%解決。
- **#44**: 北國84回t1145(2025)・山口11回A t925(2023)・秋田7回ABC/DE t1031/t1025(2024)・秋田8回ABCD/DE t1137/t1123(2025)。**2つの独立した構造的欠陥**: ①北國=原本5シートが全て同一内容の完全複製で既存パーサがシート名をそのままクラス名にするため5倍重複+全クラス混在。②秋田/山口=不戦マーカーの省略表記「不」を既存パーサが未認識。専用抽出器(`_hokkoku84_extract.mts`/`_shuki4_extract.mts`/`_shuki4_reingest.mts`)で6大会とも100%解決。

**総括**: opp_null_normal 3,868 → 2,233（−1,635）。totals: tournaments 1,495不変・participants 368,481不変・matches 823,504（+77=千葉の不戦勝行追加分）。

## 次にやること（(a)確定null受容フェーズ・ユーザーと合意した方針から再開）

### 現状 opp_null_normal 2,233 の内訳（大会別・降順・上位30、本番read-only実測 2026-07-06時点）

| tid | 大会 | opp_null | with_name | no_name | 状態 |
|--:|---|--:|--:|--:|---|
| 1459 | 埼玉20回 | 453 | 453 | 0 | **確定クローズ済(#39)** |
| 1385 | 兵庫18回 | 203 | 0 | 203 | (a)判定済(N0散在・隠れ級なし) |
| 1240 | 兵庫17回 | 77 | 0 | 77 | (a)判定済(同上) |
| 640 | 多摩初心者西東京 | 72 | 72 | 0 | **確定クローズ済(#43)** |
| 1318 | フランス1回 | 64 | 64 | 0 | (a)確定(ローマ字) |
| 1581 | 神奈川14回 | 52 | 52 | 0 | (a)session3残差(#32) |
| 1442 | 兵庫13回 | 50 | 41 | 9 | (a)session3残差(#33) |
| 641 | 福井小中34回 | 46 | 46 | 0 | (c)原本誤記(contradiction)型・未着手 |
| 1463 | 山梨2回 | 39 | 21 | 18 | (a)session3残差(#36) |
| **747** | **東大阪28回** | **36** | 36 | 0 | **未着手・原本未入手** |
| **670** | **杉並13回** | **33** | 1 | 32 | **未着手・原本未入手** |
| **705** | **小中学生選手権44回** | **31** | 1 | 30 | **未着手・原本未入手** |
| **777** | **水沢28回** | **31** | 15 | 16 | **未着手・原本未入手** |
| 1394 | 愛知23回(D,E) | 29 | 0 | 29 | 未着手・原本未入手 |
| 801 | 兵庫15回 | 29 | 29 | 0 | (c)横展開済み残差(#41) |
| 636 | 宗像35回 | 29 | 29 | 0 | 見送り確定(#37・同姓同名リスク受容) |
| 654 | 大学選手権18回 | 27 | 11 | 16 | 未着手・原本未入手 |
| 652 | 杉並12回 | 27 | 0 | 27 | 未着手・原本未入手 |
| 656 | 広島22回 | 27 | 27 | 0 | 未着手・原本未入手 |
| 642 | 岡山2回 | 25 | 25 | 0 | 見送り確定(#37) |
| （以下 <25件で分散） | | | | | |

### 論点（次セッションで判断すること）

**session4で判明した重要な事実**: 千葉9回・鳥取2回・鳥取3回・北國84回・秋田4大会・山口11回A の**9大会すべてが原本入手により100%または99.8%解決**した。事前は「原本無記載」「N0散在」と推定していたが、実際はいずれも**既存パーサの認識漏れ**（No+氏名2列誤認識／シート完全複製／不戦マーカー省略表記）が真因だった。この実績を踏まえると、**まだ手つかずの中規模候補（東大阪28回36件・杉並12+13回60件・小中学生選手権44回31件・水沢28回31件・愛知23回29件・大学選手権18回27件・広島22回27件など）にも、同種の構造的パーサ問題が眠っている可能性が高い**。

次セッション冒頭でユーザーに提示し判断を仰ぐこと:
1. **さらに原本入手を試すか**（東大阪・杉並2件・小中学生選手権・水沢・愛知・大学選手権・広島など、合計200件強）。過去の実績（千葉/鳥取/北國/秋田/山口が軒並み100%）を踏まえると期待値は高い。
2. **ここで打ち切り、残り全部を(a)確定null受容とするか**。

いずれの場合も、最終的に「回収不能→null確定」と結論した分は、台帳に**最終クローズ行**として記録し、`REFERENCE_相手未解決3868件_2026-07-06.md`を最終版（`REFERENCE_相手未解決確定版_2026-07-06.md`等の名称）に差し替えて Tier2⑨ を完了扱いにする。

### (a)確定null受容の進め方（②を選んだ場合）
- 残る opp_null_normal（現在2,233件、上記表の「未着手」「(a)判定済」「見送り確定」を全て含む）を、大会別に「なぜ回収不能と判断したか」の一言理由を付けて台帳末尾に一括記録する。
- 原則「誤って結ぶよりnull」を維持。DB操作は一切不要（現状維持）。
- 記録後、`REFERENCE_相手未解決3868件_2026-07-06.md`に最終状態の総括を追記し、Tier2⑨のステータスを「完了」に更新する。

## ドライバ資産（apps/web/・scratch・未commit）
- **session4新規**: `_expand2_extract2.mts`/`_expand2_reingest.mts`（No+氏名2列見出し形式の専用抽出器。同型の他大会があれば再利用可）／`_hokkoku84_extract.mts`（1シート内に複数クラスが完全複製されている構造への対応。「級」列でのクラス再分割）／`_shuki4_extract.mts`/`_shuki4_reingest.mts`（不戦マーカー省略表記「不」対応＋秋田/山口それぞれの列レイアウト抽出）／`usa_dry.py`/`usa_gen.py`（姓のみ異体字ミラーbackfillのPython DRY resolver。同型の残存候補があれば再利用可）
- 既存: `_t1ingest.mts`/`_chihaya_ingest.mts`/`_t2a_backfill.mts`/`_t2b1_backfill.mts`（姓名解決器・バグ修正済み）/`_xls_block_split.mts`/`_xls_multisection_split.mts`/`_kanagawa14_extract.mts`/`_yamanashi2_addclasses.mts`
- 原本ダンプ: `docs/data-quality/大会結果再取得/`〜`大会結果再取得4/`（xlsx/xls/pdf、git内・ユーザーが都度格納）
- 既知所属名リスト: `C:/tmp/dq/tier2/reingest2/known_affiliations.csv`（14,295件）
