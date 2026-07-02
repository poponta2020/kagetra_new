---
name: project_tama_duplicate_cleanup_2022
description: 本番DBで2022多摩大会の重複A/B大会を削除(1245/1247)・2024は重複でなく削除せず
metadata: 
  node_type: memory
  type: project
  originSessionId: 65797546-8a4d-41be-8a27-70d51a0ed5b9
---

2026-07-02 本番DB(`kagetra`@Oracle東京, `sudo docker exec kagetra-postgres psql`)で **第29回全国競技かるた多摩大会(2022, edition 370) の重複大会2件を削除**。

**原因**: 協会が結果を日程ごとに別ファイルで公開 → 別大会として取込。5/1の`4294`が**A+B+C累計の完全版**(=DB 1248「(A,B,C)」)なのに、4/29の`4278`(A only→1245)・4/30の`4290`(B only→1247)も残っていた。1245・1247は1248のA/B級と**参加者集合が双方向で完全一致**(差分0)、1248の方が試合数も多い(B2で60>52)。

**削除**: `DELETE FROM tournaments WHERE id IN (1245,1247)` を単一tx。cascade で classes(-7)/participants(-227)/matches(-461)。孤児選手0・result_drafts参照0。global: tournaments 1496→1494, classes 8689→8682, participants 367675→367448, matches 819703→819242。削除前backup=`c:/tmp/tama_dup_delete_backup_2026-07-02/*.csv`(全rows・COPY復元可)。edition370残=1248(A,B,C)/1276(D)/1277(E)/1290(09/24)。

**2024(第31回, edition 372)は重複なし=削除せず**(ユーザー決定)。非自明: 2024は級ごとに別ファイル公開でABC累計版が存在しない。DB 999「(07/27)全体」(221人/469試合)は`B級大会結果.xlsx`由来=**B級の唯一の記録**(級分割できず"全体"に集約・A級998とは選手0人重複・全国の他B級大会と選手名大量一致で確証)。消すと2024B級が全消失。残る品質難点=タイトル「(07/27)」/級名「全体」が本来「B」(ラベル修正は別スコープ)。

参照: [[project_bulk_load_handover]](投入元・接続情報)・[[project_player_name_display_mode]](削除でdisplay_name再計算は事実上no-op=1248に同名残存)。
