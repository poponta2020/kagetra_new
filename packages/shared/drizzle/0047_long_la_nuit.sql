-- entry-groups タスク3（2/2）: 旧 event 帰属の列を落とす。
--
-- 0046 と分けてあるのは drizzle-kit generate の都合。「1列追加 + 1列削除」を同一 migration に
-- すると generate がリネーム候補として対話プロンプトを要求し、非TTY環境では必ず落ちる。
-- 追加（0046）と削除（0047）を別パスにすると曖昧性が無くなり、どちらも自動生成できる。
-- 本番は db:migrate で連続適用するので、event_id と entry_group_id が併存する中間状態は
-- 外から観測されない。**このファイルは自動生成のまま（手修正なし）。**
ALTER TABLE "line_channels" DROP CONSTRAINT "line_channels_assigned_event_id_unique";--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" DROP CONSTRAINT "event_line_broadcasts_event_id_unique";--> statement-breakpoint
ALTER TABLE "line_channels" DROP CONSTRAINT "line_channels_assigned_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" DROP CONSTRAINT "event_line_broadcasts_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "line_channels" DROP COLUMN "assigned_event_id";--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" DROP COLUMN "event_id";