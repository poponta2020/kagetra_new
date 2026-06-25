-- 同定キーを (normalized_name, affiliation) → (normalized_name) のみへ変更（所属会は識別に使わない＝homonym-risk-accepted）。
-- 本番投入前で players は 0 件のため、データ移行（重複の名寄せ・既存 affiliation の null 化）は不要で
-- bare な制約張替えで安全。以降の player は修正後 materialize（姓名のみ同定・player.affiliation=null）が生成する。
ALTER TABLE "players" DROP CONSTRAINT "players_normalized_name_affiliation_uq";--> statement-breakpoint
DROP INDEX "idx_players_normalized_name";--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_normalized_name_uq" UNIQUE("normalized_name");