---
name: project_senseki_detail_redesign
description: "戦績詳細(/players/[id])リデザイン SHIPPED(PR#183 + 小修正#191) — A案エディトリアル＋順位は対戦から導出＋R1相手名タップ→戦績。残=本番実機目視"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4968490f-a836-4484-98f1-c943ee2f2bfe
---

戦績詳細 `/players/[id]`（tournament-results Task5 の読取専用MVP）が「キャリア集計サマリー無し＋大会の多い選手で試合表が長すぎ」で見づらい→リデザイン。主用途＝**他選手の履歴を眺める**。[[impl_design_screen_skill]] の初回実行として Claude Design 上で見た目を確定。

**確定（design-spec LOCKED ＝ `docs/features/senseki-detail-redesign/design-spec.md`、方向性A）:**
- **エディトリアル/フラット**: カードの箱を廃し和紙地に直接組む。サマリーは箱なし（氏名＋現在の級、通算/勝率を serif、薄い1行で `47大会 ・ 優勝5 ・ 入賞18 ・ 2010–2026`）。
- **年(暦年)で畳む sticky 見出し**。展開単位＝年で、その年の全大会の試合表をまとめて表示。試合は**決勝→1回戦の降順**、枚数+勝敗を `○12`/`×7` の1トークン、**相手名に所属会併記**（`matches.opponent_participant_id`→`tournament_participants.affiliation`、未解決は空欄）。
- **順位は free-text `final_rank` に依存せず対戦から導出**（ユーザー要望＝自由記述を持つのが気持ち悪い）: 級内 `maxRound`=決勝、各選手の最終試合の round/result で 優勝/準優勝/ベスト4/8…。`round_label`(決勝/準決勝/準々決勝) 優先。**入賞=ベスト8以上**。導出不能な級（リーグ/順位戦/予選+本戦混在/3位決定戦/シード不戦/データ欠け）のみ保存 `final_rank` に**フォールバック**。**`final_rank` 列の物理削除は別タスク**（全フォーマット監査が前提・本リデザインに混ぜない）。
- 年スパンは en ダッシュ `–`／順位・級は Pill でなく text（意図的逸脱）。

**実装申し送り**: `getPlayerRecord`([apps/web/src/lib/players/queries.ts]) に opponent participant→affiliation の join 追加・順位導出のエッジ(3位決定戦/リーグ判定)をテスト・多作選手の matches で N+1 回避。既存 Card/Pill から flat text へ寄せるため本ページ専用実装になる。

**co-evolving（2レンズ螺旋）:** design round2 で骨子 lock → が emergent logic「相手名タップ→その選手の戦績」が出て [[feedback_design_spec_is_requirement_for_ui]] の流れで requirements.md を delta 起票。R1=相手名(opponent_participant_id 解決時のみ)→その player_id の /players/[id] へ・同名は統合 player。R1 はユーザー承認で確定・他 emergent logic 無し。affordance D1 はユーザー指定で**黒・下線なし（明示 affordance なし＝通常テキストのまま、タップ遷移のみ）**で確定＝両宿題ゼロで**収束**（design-spec locked / requirements completed）。

**SHIPPED**: PR#183 merge `1d81bd6`（placement.ts 順位導出＋級ゲート isDerivableClass[敗北数=参加者-1]・getPlayerRecord 拡張・SensekiTimeline）。Codex 5R pass・CI green・本番デプロイ成功。**小修正 PR#191 merge `e953838`**＝①初期は全年畳む ②相手リンク導線ヒント小表示 ③相手から遷移時は相手リンクの `?from={id}` で戻る導線を遷移元へ（getPlayerName 追加）。残=本番実機目視。フロー正典=docs/dev/feature-flow.md。元データ系は [[impl_tournament_results]]・[[project_player_name_display_mode]]。
