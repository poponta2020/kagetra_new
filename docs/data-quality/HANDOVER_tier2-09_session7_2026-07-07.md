# Tier2 ⑨ 次セッション引継ぎプロンプト（session7末・2026-07-07）

以下をそのまま次セッションの最初の指示として貼れる。

---

本番結果データ点検 **Tier2 ⑨「欠け大会の回収」の続き**。台帳＝`docs/data-quality/result-fix-ledger.md`（#1-#56適用済・全 read-back OK）。**このマシンが Tier2 実施機**。

## 現況（着手前に必ず本番 read-only で再確認）

- 本番 totals: tournaments **1,495** / participants **368,507** / matches **823,648** / **opp_null_normal 817**（with_name 624 ＋ N0 193）
- read-only 経路（PW不要）: `ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com "sudo docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGCLIENTENCODING=UTF8 kagetra-postgres psql -U kagetra -d kagetra -A -F'|'" < query.sql`（日本語出力はファイルにredirectしてRead）
- **本番書込＝2経路**:
  1. **純UPDATE（relink/backfill系）**: `docker exec` に SQL を直接パイプ（read-only PGOPTIONS を外す）で十分・トンネル不要・後始末不要。self-completeなtx（inline binds＋NULL限定＋同クラスtp存在ガード＋件数アサーション）で流す。
  2. **reingest（materialize経由）**: SSHトンネル（`ssh -i ~/.ssh/id_ed25519_oracle -N -L 127.0.0.1:15432:127.0.0.1:5432 -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 ubuntu@new.hokudaicarta.com` → `DATABASE_URL=postgresql://kagetra:<urlenc-PW>@127.0.0.1:15432/kagetra`、PW=`ssh ... "sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD"`）。**`-o ServerAliveInterval=15` を必ず付与**（session7でkeepalive無しのトンネルが1回死んで再接続する事故があった）。使い終わったら確実に閉じる: `Get-CimInstance Win32_Process -Filter "Name='ssh.exe'"` でPID特定→`taskkill //F //PID <pid>`。
- ★reingestドライバは `TSX_TSCONFIG_PATH=C:/Users/popon/kagetra_new/kagetra_new/apps/web/tsconfig.json` を必ず渡す。長時間になるので **run_in_background**（タイムアウトkill禁止＝ゾンビtx）。1,000〜2,000行規模の materialize は数分〜10分程度かかる（1076参加者+2282試合の兵庫18回で約9分）。

## session7で完了した分（台帳#53-56・opp_null_normal 1,498→817・当方−681）

ユーザーが `docs/data-quality/大会結果再取得5/` に5ファイルを格納 → 続きから着手。

1. **parseResultExcel（apps/mail-worker/src/result-import/）の3件のバグを発見・恒久修正**（commit `209121f`・main push済）:
   - `normalize.ts` の `parseScoreCell` が完全一致「不戦勝」のみ検出し、本人視点シートの裸「不戦」（勝敗マークが別列）が `status='normal'` + `opponentName=null` に誤分類されていた（`round-cell.ts` は既に部分一致で正しく処理済み・不整合を解消）。
   - 印刷ページ跨ぎで「選手名」ヘッダ行が繰り返される兵庫大会形式で、そのヘッダ行自体が phantom participant として取り込まれていた。
   - 複数ブラケット（A1/A2/A3等）を1シートに結合した形式で、区切りの「A2級」マーカー行も phantom participant として取り込まれていた。
   - `isPhantomNameCell()` で②③をまとめて対処。回帰テスト4件追加、既存176件は無改修（179 green）。
2. **兵庫18回 t1385→t1597（203件解決・→0）**: `2023兵庫大会詳細結果.xlsx`。修正後のパーサで旧DBとparts/matches/氏名が完全一致（diff0）を確認しDELETE+materializeで差し替え。
3. **兵庫17回 t1240→t1598（77件解決・→0）**: `2022兵庫大会詳細結果訂正版.xlsx`。同型（#53と同一バグが原因）。
4. **兵庫11回 t1440（BB級4件のみbackfill）**: 原本(.xls)の列レイアウトが「N回」(N回戦でない表記)+[score,opponent,mark]という非標準形式でparseResultExcelの署名検出に非対応と判明。BB級4件（姓のみ・相互reciprocal・クラス内一意）のみ安全にbackfill。E級5件（相手参加者自体がDB不在）は見送り。
5. **埼玉20回 t1459→t1599（397件解決・→残1）— 「原本URL未取得で回収不能確定」の過去判定を覆す大発見**: 原本PDF(`2011saitama_detail.pdf`)を入手した結果、**旧DBの構造自体が根本的に誤り**と判明（複数クラスを1つの「A級」196人に誤統合・opp_null 324/196=65.6%）。原本は県A級/上級/中級-1/2/初級-1/2/入門級-1~4の**本当は10クラス構成**（計276名）。pdfplumberの`extract_words()`で単語x座標を取得しヘッダ行の相手/勝敗ラベル位置からラウンド列境界を動的算出する専用パーサ(`saitama_extract.py`)を新規作成。参加者数が全10クラスで告知数と完全一致（276/276）・対戦相手解決623/624（残り1件は原本自体の表記ゆれ「美由希」/「未由希」）を検証した上で全面再構築。**教訓＝過去に確定クローズした項目でも原本が手に入れば覆りうる**。

## 次にやること：残opp_null_normal 817件の内訳（上位・2026-07-07実測）

| tid | 大会 | 開催日 | opp_null | with_name | N0 | メモ |
|---|---:|---|---:|---:|---:|---|
| 641 | 福井34回小中学生 | 2011-11-06 | 46 | 46 | 0 | harvest範囲内・要調査 |
| 1442 | 兵庫13回 | 2016-04-29 | 45 | 36 | 9 | 既存ファイルあり（`大会結果再取得/13thHyogoResults.xls`）・#33で軽量backfillのみに留めた経緯・フル再取込で追加回収余地 |
| 640 | 多摩初心者(西東京市) | 2011-10-10 | 32 | 32 | 0 | #43で「団体戦形式のため確定クローズ」済のはずだが再実測で32件残存＝要再確認 |
| 1463 | 山梨2回 | 2024-06-02 | 30 | 19 | 11 | #36でD/E級追加済のはずだが再実測で30件残存＝要再確認（A級側の可能性） |
| 1394 | 愛知23回(D,E) | 2023-06-03 | 29 | 0 | 29 | session4引継ぎの「未着手7候補」の1つ・処理漏れ（harvest外・原本要入手） |
| 636 | 宗像35回 | 2011-06-19 | 29 | 29 | 0 | #37で「同姓同名の曖昧・見送り確定」済のはず＝要再確認 |
| 1318 | フランス1回 | 2022-11-12 | 28 | 28 | 0 | ローマ字表記が原因の既知パターン(a)回収不能・確定済 |
| 642 | 岡山2回 | 2011-11-27 | 25 | 25 | 0 | #37で「同姓同名の曖昧・見送り確定」済のはず＝要再確認 |
| 1503 | 山口3回初段認定 | 2023-03-05 | 16 | 7 | 9 | harvest外・優先度低 |
| 801 | 兵庫15回 | 2018-04-30 | 15 | 15 | 0 | ★原本未入手 |
| 1584 | 兵庫16回 | 2019-04-29 | 14 | 0 | 14 | 既存ファイルあり（`大会結果再取得/2019hyogo_detail.xlsx`+`大会結果再取得2/`のA-E分割PDF）・#28/#38で構造修正済・残差の可能性 |

**優先度の高い判断ポイント**:
1. **636/640/642/1463 は過去セッションで「確定クローズ」または「解決済」としていたはずの大会が再実測で残存件数を示している** — 実際に未解決が残っているのか、それとも別クラス（例: 山梨2回のA級）が新たに寄与しているのかを最初に確認すること。台帳の該当行（#36/#37/#43）と実データの整合を取ってから動く。
2. **兵庫13回・16回は既存ファイルがある** ので、フル再取込（#33/#28の軽量対応から格上げ）の費用対効果を検討。
3. **兵庫15回・11回E級5件** は原本未入手（ユーザーに追加入手を依頼するか、確定null受容にするかの判断）。
4. **愛知23回D,E t1394** は session4 で「未着手候補」に挙がっていたのに session5 で処理漏れになっていた（東大阪28/杉並12+13/小中44/水沢28/大学18/広島22は処理済）。harvest外（2022+）のため原本入手が必要。

## ドライバ資産の所在

- session7新規（このマシン別セッションID配下scratch・git外）: `saitama_extract.py`（pdfplumber座標パーサ）/`saitama_to_parsedclass.py`/`t1440_candidates.sql`等。
- session7新規（apps/web/、未commit・established convention通り）: `_hyogo17_reingest.mts`/`_hyogo18_reingest.mts`/`_saitama20_reingest.mts`+`_saitama20_classes.json`。
- session5-6資産（別セッションID配下scratch）: `resolve_full.py`/`recip_fill.py`/`relink_pairing.py`/`validate_binds_all.py`/`hiroshima_relink.py`/`xls_inspect.py`/`univ18_build.py`。
- 兵庫関連の過去セッションscratch（apps/web/、未commit）: `_hyogo13_inspect*.mts`/`_hyogo16_*.mts`/`_hyogo21_parsecheck.mts` 等、多数の探索ドラフトが残存（過去セッションの掃除忘れ・並行作業ではない）。
- 原本: 会員pageローカルharvest `/c/tmp/karuta_results/{YYYY}/`（2010-2021）＋ `docs/data-quality/大会結果再取得{,2,3,4,5}/`（ユーザー個別格納分）。会員page資格情報=repo rootの`.credentials.local.md`（gitignored）。
- **`docs/data-quality/REFERENCE_相手未解決3868件_2026-07-06.md` は件数が大幅に古くなっている**（3,868→817）。次回この規模の分析が必要になったら再生成すること。
