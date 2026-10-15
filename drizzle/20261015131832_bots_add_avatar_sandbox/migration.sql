ALTER TABLE "bots" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "sandbox_id" text;--> statement-breakpoint
-- Hand-added: carry each bot's face seed over to the new avatar column.
UPDATE "bots" SET "avatar" = "face_seed";
