# Tier2 ⑨ 次セッション引継ぎプロンプト（session3 末・2026-07-06）

以下をそのまま次セッションの最初の指示として貼れる。

---

本番結果データ点検 **Tier2 ⑨「欠け大会の回収＋残結線不能の最終処分」の続き**。台帳＝`docs/data-quality/result-fix-ledger.md`（#1-#38適用済・全 read-back OK）。**このマシンが Tier2 実施機**。

## 現況（着手前に必ず本番 read-only で再確認）
- 本番 totals: tournaments **1,495** / participants **368,481** / matches **823,427** / **opp_null_normal 3,868**
- read-only 経路（PW不要）: `ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com "sudo docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGCLIENTENCODING=UTF8 kagetra-postgres psql -U kagetra -d kagetra -A -F'|'" < query.sql`（日本語出力はファイルにredirectしてRead）
- 本番書込=SSHトンネル（既存トンネルが 127.0.0.1:15432 で生存中のことあり・`ExitOnForwardFailure`で再張り）: `ssh -i ~/.ssh/id_ed25519_oracle -N -L 127.0.0.1:15432:127.0.0.1:5432 ubuntu@new.hokudaicarta.com` → `DATABASE_URL=postgresql://kagetra@127.0.0.1:15432/kagetra` + `PGPASSWORD=$(ssh ... "sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD")`（保存しない）
- リハ: `postgresql://kagetra:kagetra_dev@127.0.0.1:5433/kagetra_rehearsal`（Docker kagetra-db）。session3で兵庫16/21・益田25/20・神奈川14・兵庫13・札幌1・埼玉32・山梨2のテスト分が入って drift 済（新tid付与や一部件数が本番とズレることがある。tid不一致時はtournaments行を`OVERRIDING SYSTEM VALUE`で手動INSERTしてから検証する手も使った）
- ★実行の罠: driver は `pnpm --filter @kagetra/mail-worker exec tsx ../web/_xxx.mts` で走らせるが、materialize.ts の `@/` alias 解決に **`TSX_TSCONFIG_PATH=C:/Users/popon/kagetra_new/kagetra_new/apps/web/tsconfig.json` を必ず渡す**
- ★長時間の本番書込は run_in_background（タイムアウトkill禁止＝台帳#21・#27ゾンビtx教訓。#27では2分Bashタイムアウトでゾンビtxが発生したが幸い正常コミットしていた。run_in_background徹底で以後再発なし）
- ★materializeResultDraft/placement/recompute-display-name 等 `apps/web/src/lib/**` の内部モジュールをスクリプトから直接importするとCJS/ESM interopで`default`ラップされることがある（`(mod as {default?}).default ?? mod`パターンで対処。`_yamanashi2_addclasses.mts`参照）

## session3で完了した分（台帳 #27-38）
Tier2⑨§2-2b「欠け大会の原本再取込」11大会が完遂。詳細は台帳参照。要点のみ：
- **兵庫21(#27)/兵庫16(#28→#38で再修正)/益田25(#29)/益田20(#30)/神奈川14(#32)/兵庫13(#33・軽量backfillのみ)/札幌1(#34)/埼玉32(#35・大会名N-4「第32回」→「第23回」も訂正)/山梨2(#36・唯一の追加型=既存A級68人は無変更でD/E1-E4級90人を新規追加)** = 参加者総計+約1,700名回収。
- **姓名解決器バグ発見+修正+本番4件revert(#31)**: `_t2b1_backfill.mts`が「唯一の姓一致候補は無条件で確定」としており同ラウンド整合を未検証だった。カナ異体字コリジョン(斎藤/齋藤)で無関係な同姓者への誤結線を発見・修正（`good`フィルタを唯一候補にも適用するガード追加）。既適用済みの兵庫16(3件)・益田20(1件)の誤結線もnullへ復元。**今後このスクリプトを使う際は既に修正済み版**。
- **兵庫16 再修正(#38)**: ユーザーの質問「回戦だけで相手が一意に決まるのでは」がきっかけで、#28時点のB/C/E級が実は**横並び2ブロック×縦2〜3セクションの入れ子構造**（例: B級は本来B1+B2+B3+B4=217人なのに先頭セクションのB1+B3=111人だけ取込・後半106人が丸ごと欠落・回戦番号も後半セクションで7〜12にズレ）と判明。**新規`_xls_multisection_split.mts`**（'氏名'ヘッダの複数出現行でセクション分割→各セクション内で列位置により側面ブロック分割→同名ブロックの跨ページ再出現はマージ）で再取込。932人→**1,246人**・未解決621→**22**。**益田25/20は同じ懸念で再確認したが問題なし**（ヘッダー行は各シート1回のみ出現）。
- **宗像35(t636)・岡山2(t642)=見送り確定**: 原本にA-D 4シートは揃っていた（「AB級欠落」は杞憂）が、真因は同姓同名の曖昧（渡邉/渡辺、西村/西村等）で解決器が0件しか解決できず、再取込しても対戦数不変と判明→[[project_homonym_risk_accepted]]方針通り現状維持。

## 次にやること（session3末でユーザーと合意した方針）

### A. 埼玉20回(t1459) = 「大会データなし」として §B の確定不能リストに追加
台帳#18で「多クラス統合誤取込+姓のみ切詰」と判明済み（二重取込ではない）。正しく直すには原本フルネーム版PDF＋級分割での再取込が必要だが**原本URL未取得**。ユーザー判断（2026-07-06）：この状態のまま**回収不能扱いとして§Bのconfirmed-dead/メタ誤りクローズ作業に含める**（新規の原本探索はしない）。

### B. confirmed-dead・メタ誤りの台帳クローズ（記録整理のみ・DB書込なし）
以下をひとつのクローズ用ledger行（またはセクション）にまとめて記録する。**内容は既に`docs/data-quality/大会目視確認結果.txt`とPLAN_tier2-09にユーザー確認済み**のため、新規調査は不要。台帳(result-fix-ledger.md)に正式な「確定・対応不要」の行を追加するだけの作業：
- 回収不能82（中止16／開催不明・結果未掲載64／入賞集計のみ1=シニア28／入賞者のみ1=鹿児島選手権40）
- 未開催2026年 6件
- バンコク2014第10回（.doc・入賞者のみで対戦データ非包含・確認済み）
- メタ誤り3件: さがみ野（35回=2021年は中止／36回=2022年開催）・大阪（102回A級中止／104回BC開催）・東大阪33回（BCDE中止）
- **新規**: 埼玉20回(t1459) = 上記Aの通り回収不能扱いで追加

### C. 残opp_null_normal（現在3,868件）の最終仕分け直し
`docs/data-quality/REFERENCE_相手未解決5669件_2026-07-05.md` は2026-07-05時点（旧5,669件）の棚卸しで**古い**。session3の一連の変更後の現在値3,868件で作り直す：
- (a) 回収不能→null確定
- (b) 埋めれば回収（もしあれば。session3でほぼ埋め尽くした可能性が高い）
- (c) 要調査（**宇佐神宮t702/t726のmirror_name_mismatchが最優先候補**だったので、まずこの2件が現在どうなっているか確認するところから）
- 原則「誤結よりnull」を維持。仕分け後は3カテゴリの内訳を新レポートとして`docs/data-quality/REFERENCE_相手未解決3868件_2026-07-06.md`（件数は要再集計）のような形で残す。

### D. 「氏名解決率が不自然に低い大会」に絞った監査（兵庫16型の再発防止）
**全大会の網羅監査ではない**。兵庫16で見つかった「一見成功して見えても実は級の一部が丸ごと欠けている」パターンの再発が疑われる大会だけを狙い撃ちで確認する。

**手法**（案）:
1. 本番で `opp_null_normal / (class内matches)` の比率が異常に高いクラスを持つ大会を抽出するSQLを書く（目安: 兵庫16の元の状態=B級 465対戦中465が全滅に近い状態だった。あるいは「クラスの参加者数が原本ファイル名やタイトルに書かれた総定員より明らかに少ない」を目視で拾う）。
2. 候補が挙がったら、該当tidの original file（`docs/data-quality/大会結果再取得/`にあるもの）を`readExcel`→ `Ｎｏ．`/`氏名` ヘッダの出現回数をチェックする簡易スクリプトで「隠れセクション」の有無を機械的にスクリーニングする（`_hyogo16_bce_dump.mts`や`_masuda_hidden_section_check.mts`のロジックを再利用可能。要件: 1シート内に同じヘッダ文字列が2回以上出現したら要注意）。
3. 見つかったら都度ユーザーに提示→GOをもらってから兵庫16と同じ要領で修正。
4. **注意**: この監査はTier2⑨の対象だった11大会＋今回発見した兵庫16以外にも、Tier1/Tier2で過去に再取込した大会（大垣シリーズ・北國・太宰府等）にも当てはまりうる。ただし今回のユーザー指示は「氏名解決率が不自然に低いもののみ」なので、まずは`opp_null_normal`比率での機械的スクリーニングから始め、対象を絞ってから深掘りする。

## ドライバ資産（apps/web/・scratch・未commit）
- 既存: `_t1ingest.mts` / `_chihaya_ingest.mts` / `_t2a_backfill.mts` / `_t862_backfill.mts` / `_t1388_backfill.mts` / `_t2b1_backfill.mts`（**姓名解決器・バグ修正済み**、ALL_TIDSは適宜書き換えて使う）/ `_t2b_probe.mts` / `_prodcheck.mts`
- **新規(session3)**: `_xls_block_split.mts`（1段=横並びのみの分割器。益田25/20・岡山2等で使用）/ `_xls_multisection_split.mts`（**2段=セクション×側面ブロックの分割器・兵庫16再修正で新規作成**、今後同型の隠れ構造を見つけたらこれを再利用）/ `_t2b_reingest.mts`（汎用reingestドライバ、TARGETS配列に大会ごとの設定を追記していく方式）/ `_kanagawa14_extract.mts`（縦スタック専用bespoke抽出器）/ `_yamanashi2_addclasses.mts`（**既存tournamentへの追加専用**、materializeResultDraftを模した独自Pass1/Pass2実装）
- 原本ダンプ: `C:/tmp/dq/tier2/reingest2/`（grid JSON・parsed JSON・行マップ等、git外）
- 既知所属名リスト: `C:/tmp/dq/tier2/reingest2/known_affiliations.csv`（14,295件・氏名/所属分離の判定に使用）
