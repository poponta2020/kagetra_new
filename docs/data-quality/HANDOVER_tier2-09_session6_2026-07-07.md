# Tier2 ⑨ 次セッション引継ぎプロンプト（session6末・2026-07-07）

以下をそのまま次セッションの最初の指示として貼れる。

---

本番結果データ点検 **Tier2 ⑨「欠け大会の回収」の続き**。台帳＝`docs/data-quality/result-fix-ledger.md`（#1-#52適用済・全 read-back OK）。**このマシンが Tier2 実施機**。

## 現況（着手前に必ず本番 read-only で再確認）
- 本番 totals: tournaments **1,495** / participants **368,491** / matches **823,509** / **opp_null_normal 1,498**（with_name 1,025 ＋ N0 473）
- read-only 経路（PW不要）: `ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com "sudo docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGCLIENTENCODING=UTF8 kagetra-postgres psql -U kagetra -d kagetra -A -F'|'" < query.sql`（日本語出力はファイルにredirectしてRead）
- **本番書込＝2経路**:
  1. **純UPDATE（relink/backfill系）**: `docker exec` に SQL を直接パイプ（read-only PGOPTIONS を外す）で十分・トンネル不要・後始末不要。self-completeなtx（inline binds＋NULL限定＋同クラスtp存在ガード＋件数アサーション）で流す。
  2. **reingest（materialize経由）**: SSHトンネル（`ssh -i ~/.ssh/id_ed25519_oracle -N -L 127.0.0.1:15432:127.0.0.1:5432 -o ExitOnForwardFailure=yes ubuntu@new.hokudaicarta.com` → `DATABASE_URL=postgresql://kagetra:<urlenc-PW>@127.0.0.1:15432/kagetra`、PW=`ssh ... "sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD"`）。**使い終わったら確実に閉じる**: `Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | ? {$_.CommandLine -like '*15432*'}` でPID特定→`taskkill //F //PID <pid>`。
- ★reingestドライバは `TSX_TSCONFIG_PATH=C:/Users/popon/kagetra_new/kagetra_new/apps/web/tsconfig.json` を必ず渡す。長時間になるので **run_in_background**（タイムアウトkill禁止＝ゾンビtx）。

## session6で完了した分（台帳#52・opp_null_normal 2,004→1,498・当方−506）

session5引継ぎの最有力候補①「残opp_nullへのrecip_fill/resolve_full一括適用」を実行。dumpを`{tid}:{class_name}`のtid付きクラスキーでグローバル1本化し、opp_nullを持つ全クラスの全対戦行(43,841行・85大会超)を一括取得→`resolve_full.py`(session5資産)をグローバル1回実行(Pass A=逆行reciprocal fill・Pass B=sd強制ペアリング・fixpointまで反復)。**506件解決**(recip258+sdforce248)。新規`validate_binds_all.py`でALL GREEN確認→自己完結tx(temp table+NULL限定UPDATE+件数アサーション506)で適用。適用後に再dump→再`resolve_full.py`でbound=0を確認(fixpoint到達＝この手法での追加解決余地なしを実証)。totals完全不変・opp_null_normal **2,004→1,498**。詳細は台帳#52。

## 次にやること：兵庫大会クラスタ（残363件・最大の集中箇所）

現在残る1,498件のうち兵庫シリーズが**6回次・363件**に集中（DB上の全兵庫大会を確認済み・8-10/12/14/19-21回はすでにopp_null=0で対応不要）:

| 回次 | tid | 開催日 | 未解決 | 原本の所在 |
|---|---|---:|---:|---|
| **第18回** | 1385 | 2023-04-29 | **203** | ★未入手・**最優先**（2022+のため会員pageharvest外） |
| **第17回** | 1240 | 2022-04-29 | **77** | ★未入手（同上） |
| 第13回 | 1442 | 2016-04-29 | 45 | 既存 `docs/data-quality/大会結果再取得/13thHyogoResults.xls`（#33で「印刷ページ継続断片混入・工数大」を理由に軽量backfillのみに留めた経緯あり。フル再取込すれば追加回収の余地） |
| 第16回 | 1584 | 2019-04-29 | 14 | 既存 `docs/data-quality/大会結果再取得/2019hyogo_detail.xlsx` + `大会結果再取得2/` のA-E分割PDF（#28/#38で既にmultisection構造修正済み・残りは原本由来の残差の可能性） |
| 第15回 | 801 | 2018-04-30 | 15 | ★未入手 |
| 第11回 | 1440 | 2014-04-29 | 9 | ★未入手 |

**ユーザーへの依頼**: 第17回・第18回（合計280件・最優先）の原本を会員ページから入手してほしい。第15回・第11回（合計24件）は入手できれば追加で。第13回・第16回は原本が既にあるので新規入手不要（次セッションで既存ファイルを再点検して追加回収を試すかは費用対効果で判断）。

## その他の副次候補（兵庫の次に着手する場合）

- **愛知23回D,E t1394（2023-06-03・29件）**: session4引継ぎで「未着手中規模候補」7件の1つに挙がっていたが、session5では他の6件（東大阪28/杉並12+13/小中44/水沢28/大学18/広島22）のみ処理して**これだけ処理漏れ**になっていた。harvest外(2022+)のため原本入手が必要。
- **福井34回 t641（2011-11-06・46件）/宮崎34回 t312（2016-12-18・14件）/札幌2回 t1465（2018-11-24・13件）/東京東会65回 t54（2012-01-22・10件）/桑名69回 t650（2011-04-03・10件）/水沢26回 t258（2015-09-23・8件）**: いずれも会員pageローカルharvest(`/c/tmp/karuta_results/` 2010-2021)の範囲内。session5と同じ「まずharvestに原本があるか確認→あれば自力回収」を試す価値がある(合計101件)。
- **山口3回初段認定 t1503(2023・16件)/小中学生選手権53回 t1367(2023・13件)/学生選手権96回E t1147(2025・11件)/長野初段認定1回 t1505(2022・10件)/新潟7回 t1142(2025・8件)**: harvest外・件数小さめ・優先度低。

## 確定済み・これ以上手を付けない項目（再調査不要）

- 埼玉20回 t1459（398件・原本URL未取得で回収不能確定済み）
- 宗像35回 t636（29件）・岡山2回 t642（25件）: 同姓同名の曖昧で再取込しても対戦数不変と判明・見送り確定(#37)
- フランス1回 t1318（28件）: ローマ字表記が原因の既知パターン(a)回収不能

## ドライバ資産の所在
- session6新規（このマシン別セッションID配下のscratch・git外）: `resolve_full.py`実行済みdump/binds一式、`validate_binds_all.py`。C:/tmpにも中間ファイルあり(`dump_all_null_classes_out.txt`/`binds_all.csv`等)。
- session5資産（別セッションID配下scratch）: `recip_fill.py`/`resolve_full.py`/`relink_pairing.py`/`validate_binds.py`/`hiroshima_relink.py`/`bye_count.py`/`xls_inspect.py`/`univ18_build.py`。
- 兵庫関連の過去セッションscratch（apps/web/、未commit）: `_hyogo13_inspect*.mts`/`_hyogo16_*.mts`/`_hyogo21_parsecheck.mts` 等、多数の探索ドラフトが残存（過去セッションの掃除忘れ・並行作業ではない）。
- 原本: 会員pageローカルharvest `/c/tmp/karuta_results/{YYYY}/`（2010-2021）＋ `docs/data-quality/大会結果再取得{,2,3,4}/`（ユーザー個別格納分）。会員page資格情報=repo rootの`.credentials.local.md`（gitignored）。
