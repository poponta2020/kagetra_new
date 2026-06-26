---
name: project_players_garbage_cleanup
description: rehearsal DB players ごみ行の全面クリーンアップ（団体削除・連結/1文字/文字化け整形）2026-06-26
metadata: 
  node_type: memory
  type: project
  originSessionId: 26d6137e-1164-4410-a908-3e0fd5f70452
---

ローカル `kagetra_rehearsal`(5433) の players ごみ行を一次ソース参照で是正（2026-06-26、**本番DB未変更**）。詳細=`C:/tmp/REPORT_players_garbage_cleanup.md`、バックアップ=`C:/tmp/rehearsal_backup_before_cleanup.sql`。

この DB は **`NO_CLEAN` 相当でロードされていた**（ローダ `_rehearse_load.mts` の CLEAN パスが未適用）ため、本来 CLEAN が落とすはずのヘッダ/?/順位ラベルが残存していた。

処理（players 47,654→47,471 / participants −561 / matches −427、整合性全0）:
- **A ヘッダ行**(選手名324/氏名99等 449件) → 削除
- **B 団体戦**(99 players/112 parts) → 削除（多摩687/839/1139/773・杉並670）。name=学校会名型 と name=メンバー姓連結型(670 G級/773 Sheet1)の2形態。`ねんりん`(個人)・外国人個人(DAVIS ALARIC EDWARD)は誤検出除外。空団体クラス7削除
- **B′ 連結名**(京都小倉 tid874, 36件) → `所属 姓 名`分離・既存選手へ統合
- **C 1文字切れ**(77件) → **Excelの姓/名別セルを source再パースで完全復元**(西→西奈津子)。`recover_c.py`+`assess_input.jsonl`。siblings はクラス↔シートで分離
- **F 文字化け?**(38→17) → 21復元(skeleton3/spurious-?除去17/所属照合1)。**残17は協会HTMLが稀字を?化＝復旧不能**で実在個人のため保持(削除しない)

再現エンジン=`apps/web/_reresolve.mts`(normalizePlayerName+get-or-create+recomputePlayerDisplayNames再利用、孤児削除込み)。**本番反映は dump方式に決定([[project_bulk_load_handover]] §4)＝この clean済リハDBを5テーブル pg_dump→本番(空)へ restore。ローダを本番で動かさない＝再混入なし**(clean結果がデータに焼込済)。将来もしローダを本番直実行する経路に戻すなら、ローダ `isHeaderJunk` が `氏名/選手名` を取り逃す・団体/1文字切れ非対応な点の対処が要る。team は別スコープ見送り確定と整合。dump 元最終件数=tournaments1453/players47,471/participants369,410/matches822,530。
