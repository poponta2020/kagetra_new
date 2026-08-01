# DBテーブル定義: 大会系列・名簿・選手・結果

`docs/design/db.md` から分割。生成元は `packages/shared/src/schema/` の各Drizzle定義。スキーマ変更時は同じコミットで更新すること。

## tournament_series（TS: `tournamentSeries`）

定義ファイル: `packages/shared/src/schema/tournament-series.ts`

大会「系列」マスタ（「第N回○○大会」の○○にあたる単位）。raw SQLで本番投入済み（series 180）の現物をDrizzle管理下に取り込んだもの。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| name | text | NOT NULL | — | UNIQUE |
| aliases | text の配列 | NOT NULL | `'{}'::text[]` | 名寄せ（resolveOrCreateEdition）用の別名 |
| short_name | text | NULL | — | 大会一覧の通称表示用略称。NULL=正式名称フォールバック |
| kind | tournament_kind (enum) | NOT NULL | 'individual' | |
| note | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE `tournament_series_name_key` on (name)

## tournament_series_editions（TS: `tournamentSeriesEditions`）

定義ファイル: `packages/shared/src/schema/tournament-series-editions.ts`

系列の「開催（第N回）」。`events`/`tournaments`を束ねるハブ（どちらもN:1）。raw SQLで本番投入済み（editions 1236）の現物。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| series_id | integer | NOT NULL | — | FK `tournament_series_editions_series_id_fkey`→tournament_series.id ON DELETE CASCADE |
| edition_number | integer | NOT NULL | — | |
| year | integer | NULL | — | |
| status | tournament_status (enum) | NOT NULL | デフォルトなし | 開催ごとに必ず確定させる |
| source_filetype | text | NULL | — | 取込元プロビナンス |
| raw_name | text | NULL | — | 取込元プロビナンス |
| competition_category | competition_category (enum) | NOT NULL | 'unknown' | official / new_year / hosted / supported / other / unknown。出場回数集計はofficial/new_yearのみ |
| competition_category_source_mail_id | integer | NULL | — | 根拠メール。FK→mail_messages.id ON DELETE SET NULL |
| competition_category_note | text | NULL | — | メール外の一次資料など区分根拠 |
| competition_category_verified_at | timestamptz | NULL | — | 区分確認日時 |
| competition_category_verified_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE `tournament_series_editions_series_id_edition_number_key` on (series_id, edition_number) / FK `tournament_series_editions_series_id_fkey`

## tournament_entry_rosters（TS: `tournamentEntryRosters`）

定義ファイル: `packages/shared/src/schema/tournament-entry-rosters.ts`

大会の名簿ヘッダ。1大会(event)・種別ごとに複数版を保持し、訂正時も旧版を削除しない。対象は個人戦のみ（events.kind=individual）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| event_id | integer | NOT NULL | — | FK→events.id ON DELETE CASCADE |
| roster_type | roster_type (enum) | NOT NULL | — | |
| version | integer | NOT NULL | 1 | event・種別内の版番号 |
| published_at | date (string mode) | NULL | — | 主催者発表日 |
| source_attachment_id | integer | NULL | — | FK→mail_attachments.id ON DELETE SET NULL |
| source_mail_message_id | integer | NULL | — | FK→mail_messages.id ON DELETE SET NULL |
| supersedes_roster_id | integer | NULL | — | 訂正元roster。自己FK ON DELETE SET NULL |
| superseded_at | timestamptz | NULL | — | 訂正で旧版が無効になった日時 |
| approved_at | timestamptz | NULL | — | 検証・採用日時 |
| approved_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| note | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE `tournament_entry_rosters_event_id_roster_type_version_key` on (event_id, roster_type, version)

## tournament_entry_roster_entries（TS: `tournamentEntryRosterEntries`）

定義ファイル: `packages/shared/src/schema/tournament-entry-roster-entries.ts`

名簿の各行 = 1人。姓名のみで`players`に解決（homonym-risk-accepted）。会員は`users`に紐付け。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| roster_id | integer | NOT NULL | — | FK→tournament_entry_rosters.id ON DELETE CASCADE |
| player_id | integer | NULL | — | FK→players.id ON DELETE SET NULL。未解決はNULL（raw_nameは常に保持） |
| user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| grade | grade (enum) | NULL | — | |
| raw_name | text | NOT NULL | — | 取込元の生スナップショット（常に正） |
| raw_kana | text | NULL | — | |
| raw_affiliation | text | NULL | — | |
| raw_dan | text | NULL | — | |
| status | roster_entry_status (enum) | NOT NULL | — | 出場状態（出場回数の素データ） |
| selection_outcome | selection_outcome (enum) | NOT NULL | 'unknown' | accepted / waitlisted / rejected / unknown（抽選発表時点） |
| selection_exempt | boolean | NOT NULL | false | 主催者枠・抽選除外 |
| seq_no | integer | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**インデックス**: `roster_entries_roster_id_idx` on (roster_id) / `roster_entries_player_id_idx` on (player_id) / `roster_entries_user_id_idx` on (user_id) / `roster_entries_roster_grade_player_idx` on (roster_id, grade, player_id)

## tournament_confirmed_roster_publications（TS: `tournamentConfirmedRosterPublications`）

定義ファイル: `packages/shared/src/schema/tournament-confirmed-roster-publications.ts`

年度別出場回数へ算入する確定名簿発表。後日の追加確定発表は旧発表を消さず、開催回・級ごとに和集合で扱う。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| edition_id | integer | NOT NULL | — | FK→tournament_series_editions.id ON DELETE CASCADE |
| grade | grade (enum) | NOT NULL | — | |
| roster_id | integer | NULL | — | FK→tournament_entry_rosters.id ON DELETE SET NULL。欠落時はincomplete |
| published_at | date | NOT NULL | — | 基準日判定に使う発表日 |
| created_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**: UNIQUE `tcrp_edition_grade_roster_uq` on (edition_id, grade, roster_id) / INDEX `tcrp_edition_grade_published_idx` on (edition_id, grade, published_at)

## tournament_edition_grade_lottery_facts（TS: `tournamentEditionGradeLotteryFacts`）

定義ファイル: `packages/shared/src/schema/tournament-edition-grade-lottery-facts.ts`

開催回・級ごとに集計へ採用する申込名簿、抽選結果発表時名簿、実出場結果、級別定員を版管理する。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| edition_id | integer | NOT NULL | — | FK→tournament_series_editions.id ON DELETE CASCADE |
| grade | grade (enum) | NOT NULL | — | |
| selection_status | lottery_selection_status (enum) | NOT NULL | 'unknown' | lottery / under_capacity / no_capacity / unknown |
| capacity | integer | NULL | — | 級別定員。正数またはNULL |
| application_start_date | date | NULL | — | A級回数算定の基準日前日を求める起点 |
| applicant_roster_id | integer | NULL | — | FK→tournament_entry_rosters.id ON DELETE SET NULL |
| selection_result_roster_id | integer | NULL | — | FK→tournament_entry_rosters.id ON DELETE SET NULL |
| actual_result_class_id | integer | NULL | — | FK→tournament_classes.id ON DELETE SET NULL |
| selection_rule_version | text | NULL | — | 適用した優先抽選ルール版 |
| selection_rule_evidence | text | NULL | — | ルール版を裏付ける一次資料または正典内の根拠キー。版だけで根拠が欠ける場合は当落線を不完全扱い |
| source_mail_message_id | integer | NULL | — | FK→mail_messages.id ON DELETE SET NULL |
| verified_at | timestamptz | NULL | — | |
| verified_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| supersedes_fact_id | integer | NULL | — | 訂正元fact。自己FK ON DELETE SET NULL |
| valid_to | timestamptz | NULL | — | NULLの行がactive |
| created_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**: 部分UNIQUE `tournament_edition_grade_lottery_facts_active_key` on (edition_id, grade) WHERE valid_to IS NULL / capacity正数CHECK / selection_statusとcapacityの整合CHECK

## tournament_roster_import_drafts（TS: `tournamentRosterImportDrafts`）

定義ファイル: `packages/shared/src/schema/tournament-roster-import-drafts.ts`

メール本文または添付を構造化した、管理者確認前の名簿ドラフト。原本単位を`source_kind`で保持し、添付削除後も本文ドラフトとの冪等性制約が衝突しない。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| source_kind | roster_import_source_kind (enum) | NOT NULL | — | attachment / body |
| source_mail_message_id | integer | NULL | — | FK→mail_messages.id ON DELETE SET NULL |
| source_attachment_id | integer | NULL | — | FK→mail_attachments.id ON DELETE SET NULL |
| parser_version | text | NOT NULL | — | |
| status | roster_import_draft_status (enum) | NOT NULL | 'pending_review' | pending_review / approved / rejected / parse_failed / superseded |
| extracted_payload | jsonb | NOT NULL | `'{}'::jsonb` | |
| failure_reason | text | NULL | — | |
| inferred_edition_id | integer | NULL | — | FK→tournament_series_editions.id ON DELETE SET NULL |
| inferred_roster_type | roster_type (enum) | NULL | — | |
| inferred_grade | grade (enum) | NULL | — | |
| approved_at / rejected_at | timestamptz | NULL | — | レビュー監査 |
| approved_by_user_id / rejected_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| rejection_reason | text | NULL | — | |
| created_at / updated_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**: 添付sourceの部分UNIQUE `tournament_roster_import_drafts_attachment_key` / 本文sourceの部分UNIQUE `tournament_roster_import_drafts_body_message_key` / INDEX `tournament_roster_import_drafts_status_created_idx`

## tournament_entry_roster_files（TS: `tournamentEntryRosterFiles`）

定義ファイル: `packages/shared/src/schema/tournament-entry-roster-files.ts`

パースせず**原本ファイルのまま採用**した名簿。`tournament_entry_rosters` とは独立で、版管理も統計寄与も持たない（entries を持たない行をあちらへ混ぜると、確定名簿の entries から出場者を描き無ければ出欠へフォールバックする消費者が「出場者0人」に倒れる）。ファイル実体は複製せず `mail_attachments` が唯一の正で、この表は原本へのポインタ。帰属は `entry_group` なのでグループ内のどの日の大会詳細からも同じファイルが見える。取込単位は `grades`（NULL=グループ統一 / 非NULL=級別）で表し、級別採用でも 1 添付 1 行なので `UNIQUE(source_attachment_id)` を維持できる。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| entry_group_id | integer | NOT NULL | — | FK→entry_groups.id ON DELETE RESTRICT |
| roster_type | roster_type (enum) | NOT NULL | — | applicant / confirmed |
| grades | grade[] (enum配列) | NULL | — | 取込単位。NULL=グループ統一名簿（全級カバー）／非NULL=その級だけの級別名簿（複数級を1ファイルでカバーする場合は `{A,B}`）。保存時に dedupe + A→E 昇順で正規化 |
| source_attachment_id | integer | NOT NULL | — | FK→mail_attachments.id ON DELETE CASCADE |
| source_mail_message_id | integer | NULL | — | FK→mail_messages.id ON DELETE SET NULL |
| published_at | date (string mode) | NULL | — | 主催者発表日。既定はメール受信日(JST) |
| note | text | NULL | — | |
| adopted_at | timestamptz | NOT NULL | `now()` | |
| adopted_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| created_at / updated_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**: UNIQUE `tournament_entry_roster_files_source_attachment_key` on (source_attachment_id)（同一添付の二重採用を禁止。付け替えは解除→再採用）/ INDEX `tournament_entry_roster_files_group_type_idx` on (entry_group_id, roster_type)

## players（TS: `players`）

定義ファイル: `packages/shared/src/schema/players.ts`

選手マスタ（全国の競技者。会員/非会員問わず）。同定キーは**姓名のみ**（所属会は識別キーに使わない）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| display_name | text | NOT NULL | — | |
| normalized_name | text | NOT NULL | — | UNIQUE。空白除去・NFKC・字体揺れ吸収済みの検索/突合キー |
| name_kana | text | NULL | — | |
| affiliation | text | NULL | — | 常にNULL運用（所属は`tournament_participants`の生値が正） |
| prefecture | text | NULL | — | |
| user_id | text | NULL | — | FK→users.id ON DELETE SET NULL。v1では基本NULL |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**: UNIQUE `players_normalized_name_uq` on (normalized_name) / INDEX `idx_players_user_id` on (user_id)

## tournaments（TS: `tournaments`）

定義ファイル: `packages/shared/src/schema/tournaments.ts`

1大会 = 1取込ファイル（result_drafts 1通の承認で1行）。同一大会が複数ファイルで届いても各1行（マージは後続フェーズ）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| name | text | NOT NULL | — | |
| event_date | date | NULL | — | 大会報告シート由来。v1では基本NULL |
| venue | text | NULL | — | |
| source_result_draft_id | integer | NULL | — | この大会を生成したドラフトへの逆参照（プロビナンス）。循環FKのためplain integer。FK制約はmigrationのraw ALTERで付与（ORM relationも意図的に張らない） |
| edition_id | integer | NULL | — | FK `tournaments_edition_id_fkey`→tournament_series_editions.id ON DELETE SET NULL |
| note | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**: FK `tournaments_edition_id_fkey` / INDEX `tournaments_edition_id_idx` on (edition_id)

## tournament_classes（TS: `tournamentClasses`）

定義ファイル: `packages/shared/src/schema/tournament-classes.ts`

大会内の「級（クラス）」。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| tournament_id | integer | NOT NULL | — | FK→tournaments.id ON DELETE CASCADE |
| class_name | text | NOT NULL | — | 自由文字列（取込元シート名/級列そのまま） |
| grade | grade (enum) | NULL | — | class_nameからのbest-effort正規化値 |
| num_players | integer | NULL | — | |
| sheet_name | text | NULL | — | 取込元Excelのシート名 |

## tournament_participants（TS: `tournamentParticipants`）

定義ファイル: `packages/shared/src/schema/tournament-participants.ts`

大会・級ごとの出場スナップショット（取込元Excelの1行=1参加者をほぼロスレスに保持）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| class_id | integer | NOT NULL | — | FK→tournament_classes.id ON DELETE CASCADE |
| player_id | integer | NULL | — | FK→players.id ON DELETE SET NULL |
| seq_no | integer | NULL | — | |
| name | text | NOT NULL | — | |
| name_kana | text | NULL | — | |
| affiliation | text | NULL | — | |
| prefecture | text | NULL | — | |
| dan | text | NULL | — | 生表記のまま保持（正規化しない） |
| dan_rank | smallint | NULL | — | CHECK 1〜10またはNULL。生danからの正規化ランク（段位なし/記号/空はNULL） |
| member_no | text | NULL | — | |
| final_rank | text | NULL | — | 順位列の生テキスト（優勝/準優勝/３位…） |
| derived_bracket | smallint | NULL | — | 事前計算した順位ブラケット（1=優勝/2=準優勝/4/8/16…、導出不能はNULL） |

**制約・インデックス**:
- INDEX `idx_participants_player_id` on (player_id)
- INDEX `idx_participants_class_id` on (class_id)
- 部分INDEX `idx_participants_derived_bracket` on (derived_bracket, player_id) WHERE derived_bracket IS NOT NULL
- UNIQUE `tournament_participants_id_class_id_uq` on (id, class_id) — `matches`のcomposite FK先
- CHECK `tournament_participants_dan_rank_range`（dan_rank BETWEEN 1 AND 10 OR dan_rank IS NULL）

## matches（TS: `matches`）

定義ファイル: `packages/shared/src/schema/matches.ts`

1試合 = 選手視点1行。通常対戦は勝者○/敗者×の2行で重複出現（ロスレス）。不戦勝は1行（相手なし・`status='walkover'`）。棄権は2行（`status='forfeit'`）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| class_id | integer | NOT NULL | — | FK→tournament_classes.id ON DELETE CASCADE。冗長保持（級内の全試合クエリ用） |
| round | integer | NOT NULL | — | |
| round_label | text | NULL | — | |
| participant_id | integer | NOT NULL | — | composite FK（下記）の構成列。単独FKにはしない |
| opponent_participant_id | integer | NULL | — | FK→tournament_participants.id ON DELETE SET NULL。解決できなければNULL（`opponent_name`の生テキストを保持） |
| opponent_name | text | NULL | — | |
| result | match_result (enum) | NOT NULL | — | 常にwin/lose（不戦勝も勝者視点win） |
| score_diff | integer | NULL | — | |
| status | match_status (enum) | NOT NULL | 'normal' | normal=実戦（勝敗数に算入）/ walkover=不戦勝 / forfeit=棄権 |

**制約・インデックス**:
- INDEX `idx_matches_class_id` on (class_id)
- INDEX `idx_matches_participant_id` on (participant_id)
- composite FK `matches_participant_id_class_id_fk`: (participant_id, class_id) → tournament_participants(id, class_id) ON DELETE CASCADE（「試合の級＝参加者の所属級」をDBで保証）

## result_drafts（TS: `resultDrafts`）

定義ファイル: `packages/shared/src/schema/result-drafts.ts`

結果Excelの取込ドラフト = メール1通。mail-workerが決定的パース（AI不使用）して1行を格納する。**1メール=最大1ドラフト**（`message_id`UNIQUE）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| message_id | integer | NOT NULL | — | UNIQUE。FK→mail_messages.id ON DELETE CASCADE |
| status | result_draft_status (enum) | NOT NULL | 'pending_review' | |
| extracted_payload | jsonb | NOT NULL | `'{}'::jsonb` | パーサ生成の級/参加者/試合の構造化JSON |
| parser_version | text | NOT NULL | — | |
| parse_error | text | NULL | — | |
| superseded_by_draft_id | integer | NULL | — | 自己参照（訂正版で差し替えた旧ドラフト）。FK制約はmigrationのraw ALTERで付与 |
| tournament_id | integer | NULL | — | FK→tournaments.id ON DELETE SET NULL。承認で作成した大会 |
| approved_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| approved_at | timestamptz | NULL | — | |
| rejected_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| rejected_at | timestamptz | NULL | — | |
| rejection_reason | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**: UNIQUE(message_id) / INDEX `idx_result_drafts_status_created` on (status, created_at DESC)
