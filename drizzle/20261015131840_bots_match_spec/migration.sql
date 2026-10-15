ALTER TABLE "bots" DROP CONSTRAINT "bots_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "bots" DROP COLUMN "face_seed";--> statement-breakpoint
ALTER TABLE "bots" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "bots" ALTER COLUMN "job" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bots" ALTER COLUMN "instructions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bots" ALTER COLUMN "instructions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ALTER COLUMN "avatar" SET NOT NULL;