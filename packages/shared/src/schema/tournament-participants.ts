import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, smallint, text, unique } from 'drizzle-orm/pg-core'
import { tournamentClasses } from './tournament-classes'
import { players } from './players'

/**
 * tournament_participants: その大会・級ごとの「出場スナップショット」。
 *
 * 取込元 Excel の 1 行 = 1 参加者をほぼロスレスに保持する生データ層。`player_id`
 * は承認時に正規化キーで get-or-create した players への紐付け（未解決時は null、
 * 選手削除/再解決で null になり得るので ON DELETE SET NULL）。
 *
 * `dan` / `member_no` は **text**（"五段" / "5" / "A-123" など Excel の生表記を
 * そのまま保持。正規化はしない＝生データが常に正）。`final_rank` も順位列の生
 * テキスト（優勝/準優勝/３位…）をそのまま保持（数値化は導出不能なため）。
 */
export const tournamentParticipants = pgTable(
  'tournament_participants',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    classId: integer('class_id')
      .notNull()
      .references(() => tournamentClasses.id, { onDelete: 'cascade' }),
    playerId: integer('player_id').references(() => players.id, { onDelete: 'set null' }),
    seqNo: integer('seq_no'),
    name: text('name').notNull(),
    nameKana: text('name_kana'),
    affiliation: text('affiliation'),
    prefecture: text('prefecture'),
    // 生スナップショットのため text（"五段"/"5" 等の揺れをロスレス保持）。
    dan: text('dan'),
    // 正規化段位ランク 1–10（生 dan から normalizeDan で導出。段位なし(無/無段)・
    // 記号(●/★)・空は null）。生 dan は正データとして保持し、こちらは段位別検索／
    // 順序付け（「五段以上」「最高段位 = max(dan_rank)」）用の派生列。
    danRank: smallint('dan_rank'),
    memberNo: text('member_no'),
    finalRank: text('final_rank'),
    // 事前計算した順位ブラケット（1=優勝 / 2=準優勝 / 4=ベスト4 / 8 / 16 …、導出不能
    // 級は null）。取込承認（materialize）時に級内 matches から `derivePlacement` で確定
    // し、順位定義は戦績詳細（getPlayerRecord）と単一ソース。②大会詳細の級別順位・
    // ③優勝/入賞ランキング・②歴代優勝者を「参加グレイン」で支える派生列（期間・級
    // フィルタを WHERE で効かせるため選手単位の事前集計表ではなくこの粒度で保持）。
    // 導出不能級は null のまま呼び出し側が保存済み `final_rank` にフォールバックする。
    derivedBracket: smallint('derived_bracket'),
  },
  (table) => [
    index('idx_participants_player_id').on(table.playerId),
    index('idx_participants_class_id').on(table.classId),
    // ③選手ランキングの優勝(bracket=1)/入賞(bracket≤8)集計を支える。bracket で range
    // 絞り込み → player_id 順で GROUP BY count が効くよう (derived_bracket, player_id)。
    // 導出不能級(null)は集計対象外なので index からも除外し軽量化する部分 index。
    index('idx_participants_derived_bracket')
      .on(table.derivedBracket, table.playerId)
      .where(sql`${table.derivedBracket} IS NOT NULL`),
    // matches の composite FK (participant_id, class_id) → (id, class_id) のターゲット。
    // id は単独で PK だが、composite FK は参照先の同一列集合に UNIQUE/PK 制約を要求する
    // ため明示的に張る。これにより「試合の class_id が参加者の所属級と一致する」ことを
    // DB が保証する（matches.class_id の冗長保持が壊れない）。
    unique('tournament_participants_id_class_id_uq').on(table.id, table.classId),
    // dan_rank は normalizeDan 由来の 1–10 または null（段位なし）。backfill や将来の
    // 直接 SQL 更新がアプリ側バリデーションを迂回して不正値（0/11 等）を入れても DB が
    // 弾くよう、値域を DB レイヤでも担保する。
    check(
      'tournament_participants_dan_rank_range',
      sql`${table.danRank} BETWEEN 1 AND 10 OR ${table.danRank} IS NULL`,
    ),
  ],
)
