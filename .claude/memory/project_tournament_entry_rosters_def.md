---
name: project_tournament_entry_rosters_def
description: "大会ライフサイクル基盤(edition)＋申込/確定名簿 機能定義。editionをハブ化しseries/editionsをDrizzle化、名簿2型を新設。親Issue#184+子#185-190"
metadata: 
  node_type: memory
  type: project
  originSessionId: 06ed65e3-77fc-4efd-90fd-cea56acdc47b
---

大会ライフサイクル（案内→申込→確定→結果）を **開催(edition=第N回○○大会)** を中心に1本化し、各大会に **申込者名簿(applicant=抽選前)/確定名簿(confirmed=抽選後)** を保持する機能。将来の出場回数カウント([[reference_karuta_kounin_taikai_lottery]])の土台。**第4段(出場回数)は本機能スコープ外**（土台のみ）。

**定義完了 2026-06-29**。要件=`docs/features/tournament-entry-rosters/requirements.md`、手順書=同`/implementation-plan.md`（両方 status:completed）。**親Issue #184 ＋ 子 #185-190**。実装未着手（/do-plan 待ち）。

**確定した設計判断（1つずつユーザー合意）**:
- 判断1=X: series/editions([[project_tournament_series_master]])を**Drizzle化**。＝同memoの「Drizzle化しない方針」を本機能で**反転**。本番に raw 投入済(1236 editions/180 series, [[project_bulk_load_handover]])があるため、migrationは**冪等(IF NOT EXISTS)**＋`C:/tmp/prod_schema_series.sql`と差分ゼロ突合＋**本番dumpのコピーDBでdry-run必須**。実体名=`tournament_series`/`tournament_series_editions`、enum=tournament_kind/tournament_status。`aliases[]`/`raw_name`が名寄せ土台。
- 判断2=B: `event_group`(events.event_group_id＋event_groups表＋UI)を**撤去**しeditionに一本化（events実運用前=空で今が最安）。
- 判断3=A: 名簿(外部事実)/`event_attendances`(会員の意思)/`events.entryStatus`(会の操作)は**3層分離・自動更新しない**。突合は表示のみ、出場回数は確定名簿(事実)から数える。
- 判断4=A: 基盤先行 PR-1→…→5。
- **editionがハブな理由**: events:edition=N:1、flow②(案内なし・結果のみ)はeventを持たない→両方張れるのはeditionのみ。出場回数=確定roster(flow①)＋`tournament_participants`(flow②)を**edition×年度(4-3月)で重複排除**して数える。

**PR分割=子Issue**: #185 series/editions Drizzle化+edition_id列(events/tournaments) / #186 event_group撤去 / #187 edition解決コア(系列名寄せ name+aliases・回次パース・最大+1採番・**管理者確認必須**)＋案内承認flow① / #188 名簿2表+ファイル取込(applicant/confirmed・player姓名のみ同定[[impl_player_identity_name_only]]・user紐付け) / #189 名簿UI+会員突合 / #190 結果materializeにedition解決flow②。

**新規DB**: `tournament_entry_rosters`(event_id/roster_type(applicant|confirmed)/published_at/source_attachment_id, UNIQUE(event_id,roster_type)) ＋ `tournament_entry_roster_entries`(roster_id/player_id/user_id/grade/生name・kana・affiliation・dan/status(confirmed|carried_up|carry_up_declined|cancelled)/seq_no)。**個人戦のみ**。

UI3点(edition確認/名簿取込/名簿表示)は design-spec 宿題(`/design-screen tournament-entry-rosters`)。[[feedback_dont_rush_requirements_data_first]]に沿い実スキーマ突合で客観評価してから設計。
