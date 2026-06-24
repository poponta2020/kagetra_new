---
name: project_player_name_display_mode
description: 選手名の正規化は維持(実利~1000件実証)・display_nameをfirst-winsから代表表記(最頻の生表記)へ変更=方針②採用。計画承認済み・実装待ち(/do-plan)
metadata: 
  node_type: memory
  type: project
  originSessionId: a475da82-25a1-42e3-8c0e-d37b6e8181a8
---

過去結果の選手マスタ(players)の氏名表示方針。**正規化(畳み込み)は維持し、display_name の選び方だけ変える**ことをユーザーが選択（方針②、2026-06-24）。[[project_bulk_load_handover]] の表示まわり追補で、**本番投入はブロックしない**（participants.name がロスレスなので display_name は後からでも再計算可能）。

**実利検証（リハDB 320大会 / players 29,719）— 「正規化しなければ分裂していた人」**:
- 複数の生表記を持つ player = **421人**（= 漢字異体字 **228** + 空白/全半角 **193**）。
- 例: 渡辺/渡邉/渡邊美弓 が1人、山﨑/山崎円香、髙橋/高橋大地、濱岡/浜岡暁子、汐﨑/汐崎伸子。
- sanity: 全正規化後も差が残るのにマージ = **0**（JS↔PG の NFKC/異体字畳み込みが一致・同定キー健全）。homonym は所属で別人維持（高橋大地が player 271/1271 の2人）。
- 全1453大会換算で **異体字だけ~1,000人 / 合計~1,900人** 規模（同一所属内のみの数なので実効はさらに大）。→ **正規化の実利は明確、維持が正**。

**現状の問題**: display_name が materialize の `onConflictDoNothing` で **first-wins** のため、生(participants.name)は﨑なのに表示が崎へ化けるケースが現状 **140件**（﨑のみで計測）。生はロスレスなので可逆。

**方針②（採用・実装未着手）**:
- `normalizePlayerName`（NFKC + 空白除去 + 異体字対 髙→高 / 﨑→崎 / 邉邊→辺 / 濵濱→浜）は **同定キー normalized_name と検索（query 側も normalize）に維持**。検索は異体字非依存のまま。
- **display_name = その player の participants.name の最頻表記(mode)**。tie 時は旧字（normalized_name と異なる異体字側）優先を暫定案（要確定。代替=最新大会の表記）。
- recompute は **全 participation 横断**（materialize 単位だと他大会分を見落とす）。実装案: 再計算ロジックを (i) 既存行 backfill と (ii) materialize 末尾で touched player 分、の両方で呼ぶ → bulk/live とも常に正。
- **同定キー不変 = migration 不要**（display_name 列は既存）。1PR=1機能で別タスク化。
- **計画**: `docs/features/player-display-name-mode/plan.md`（Phase0 doc discovery 済・4フェーズ・テストファースト）。**2026-06-24 ユーザー承認済み**。実装着手は `/do-plan player-display-name-mode` 待ち。本番投入(bulk)より先にマージ。
- 関連: [[project_homonym_risk_accepted]] [[impl_tournament_results]] [[project_bulk_load_handover]] [[project_karuta_member_result_source]]
