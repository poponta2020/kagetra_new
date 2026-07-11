# Tier2 ⑨ 次セッション引継ぎプロンプト（session5末・2026-07-07）

以下をそのまま次セッションの最初の指示として貼れる。

---

本番結果データ点検 **Tier2 ⑨「欠け大会の回収」の続き**。台帳＝`docs/data-quality/result-fix-ledger.md`（#1-#51適用済・全 read-back OK）。**このマシンが Tier2 実施機**。

## 現況（着手前に必ず本番 read-only で再確認）
- 本番 totals: tournaments **1,495** / participants **368,491** / matches **823,509** / **opp_null_normal 2,004**（with_name 1,459 ＋ N0 545）
- read-only 経路（PW不要）: `ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com "sudo docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGCLIENTENCODING=UTF8 kagetra-postgres psql -U kagetra -d kagetra -A -F'|'" < query.sql`（日本語出力はファイルにredirectしてRead）
- **本番書込＝2経路**:
  1. **純UPDATE（relink系）**: `docker exec` に SQL を直接パイプ（read-only PGOPTIONS を外す）で十分・トンネル不要・後始末不要。self-completeなtx（inline binds＋NULL限定＋同クラスtp存在ガード＋件数アサーション）で流す（session5の#45/#47/#48/#50はこれ）。
  2. **reingest（materialize経由）**: SSHトンネル（`ssh -i ~/.ssh/id_ed25519_oracle -N -L 127.0.0.1:15432:127.0.0.1:5432 -o ExitOnForwardFailure=yes ubuntu@new.hokudaicarta.com` → `DATABASE_URL=postgresql://kagetra:<urlenc-PW>@127.0.0.1:15432/kagetra`、PW=`ssh ... "sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD"`）。**使い終わったら確実に閉じる**: `Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | ? {$_.CommandLine -like '*15432*'}` でPID特定→`taskkill //F //PID <pid>`（`pkill`だけでは閉じきらない）。
- ★reingestドライバは `TSX_TSCONFIG_PATH=C:/Users/popon/kagetra_new/kagetra_new/apps/web/tsconfig.json` を必ず渡す（materialize.tsの`@/`alias解決）。長時間になるので **run_in_background**（タイムアウトkill禁止＝ゾンビtx）。materializeは`(mod as {default?}).default ?? mod`でCJS/ESM interop対処。
- ★**並行セッション注意**: session5中に別セッションが札幌6回(t1466→t1594)を再取込（台帳#49・+10人/+5対戦/opp_null−20）。totalsが自分の作業外で動くことがある。read-back時は「自分のtid」で個別確認し、global totalsの差分は台帳#49等と突き合わせる。

## session5で完了した分（台帳 #45-48/#50/#51・opp_null_normal 2,233→2,004・当方−209）

会員pageローカルharvest(`/c/tmp/karuta_results/` 2010-2021・xls/xlsx原本)から未着手中規模7大会を自力回収。ドライバは全て scratch（`…/scratchpad/`）にPython、reingestのみ`scripts/diagnostics/_univ18_reingest.mts`。

| # | 大会 | tid | 手法 | 件数 | totals |
|--|---|--|---|--:|:--:|
| 45 | 東大阪28 | 747 | 姓のみ**mirror pairing**(class×round×枚数差でforced-move) | 36/36 | 中立 |
| 46 | 杉並12/13 | 652/670 | 不戦bye「不」を**walkover再分類**(原本bye数=DB N0を級単位照合) | 59/59 | 中立 |
| 47 | 広島22 | 656 | 氏名姓/名2列でroster姓のみだが**DBはseq_no保持**→原本No結合で相手同定 | 27/27 | 中立 |
| 48 | 小中44 | 705 | 小6級1回戦相手が原本で勝者側だけ空欄→**敗者側の逆行record(reciprocal fill)**で補完 | 29/31 | 中立 |
| 50 | 水沢28 | 777 | reciprocal fill(typo吸収)+**sd強制ペアリング**(E級列見出し欠落)+D3番号/譲り個別 | 31/31 | 中立 |
| 51 | 大学18 | 654→1596 | **唯一のreingest**。[対戦相手,結果,枚数]列順+姓名2列+6回戦+空欄多数でround破損。Python完全パース→249人/601対戦=DB件数一致・mirror全対称→materialize | 27/27 | 参加者/対戦不変・player再解決 |

**再利用可能な汎用手法（scratch資産）**:
- `recip_fill.py` / `resolve_full.py`: **逆行reciprocal fill**（相手が自分をopp_pidで既記録している一意行から相手を決定論補完・typo吸収）＋**sd強制ペアリング**（同クラス同round同枚数差で勝敗各1のみforced結線）。原本入手不要・totals中立・**誤結線ゼロ**（曖昧はnull）。**残opp_nullの多くにそのまま効く可能性が高い**（次セッションでまず全大会にこの2手法を一括適用してみる価値大）。
- `relink_pairing.py`（mirror pairing＋forced-move消去）/`validate_binds.py`（対称性・自己bind・クラス跨ぎ検証）/`hiroshima_relink.py`（原本round grid再構成→seq_no結線）/`bye_count.py`（不戦bye級単位カウント）/`xls_inspect.py`（.xls=xlrd/.xlsx=openpyxl 生グリッドダンプ）。
- reingest雛形: `scripts/diagnostics/_univ18_reingest.mts`（JSON→ParsedClass[]→旧DELETE→materializeResultDraft→edition復元・mirrorSafeguard null=0 assert・`REINGEST_TID`env）＋`univ18_build.py`（原本→フルネーム解決JSON化・氏名は`姓+半角空白+名`）。session4の`_shuki4_reingest.mts`も参照。

## 次にやること（候補・ユーザー判断）

1. **残opp_null 2,004への `recip_fill.py`/`resolve_full.py` 一括適用**（最有力・低リスク・totals中立）: 全大会をdumpして逆行fill＋sd強制ペアリングを回すと、原本入手不要で相当数がさらに解決する見込み。誤結線ゼロゲート内蔵。**まずこれを試すのを推奨**。
2. **harvest外(2022年以降)の中規模大会の原本入手→再取込**: harvestは2010-2021のみ。2022+の未解決大会はユーザーが会員pageから原本入手が前提（session4の秋田/北國と同様）。残opp_nullを大会別降順で洗い出し、harvest内(自力)/harvest外(要入手)/回収不能(同姓同名・原本無記載)に仕分ける。
3. **(a)確定null受容で打ち切り**: 残りを「誤って結ぶよりnull」で確定し、REFERENCE最終版に総括してTier2⑨クローズ。

いずれも session5同様、**totals中立relinkを優先**し、reingestは構造破損大会のみ・rehearsal相当の検証（原本=DB件数一致＋mirror全対称＋unresolved0）を通してから適用する。

## ドライバ資産の所在
- session5新規（scratch・git外）: `…/scratchpad/` に `recip_fill.py`/`resolve_full.py`/`relink_pairing.py`/`validate_binds.py`/`hiroshima_relink.py`/`bye_count.py`/`xls_inspect.py`/`univ18_build.py`/`univ18_eval.py`。
- session5新規（git内・未commit）: `scripts/diagnostics/_univ18_reingest.mts`/`scripts/diagnostics/_relink7_inspect.mts`。
- 原本: 会員pageローカルharvest `/c/tmp/karuta_results/{YYYY}/`（2010-2021・cid_filename形式）＋`{YYYY}_plan.csv`（category/name/kyu/href）＋`{YYYY}_html_index.csv`（cid/tournament/class/tid）。会員page資格情報=repo rootの`.credentials.local.md`（gitignored）。
- 台帳バックアップ: `…/scratchpad/bk_t{tid}_*_2026-07-07.csv`（各適用の対象行スナップショット）。
