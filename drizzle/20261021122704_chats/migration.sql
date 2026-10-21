CREATE TYPE "chat_kind" AS ENUM('direct', 'group');--> statement-breakpoint
CREATE TABLE "chat_members" (
	"chat_id" text,
	"bot_id" text,
	CONSTRAINT "chat_members_pkey" PRIMARY KEY("chat_id","bot_id")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"kind" "chat_kind" DEFAULT 'direct'::"chat_kind" NOT NULL,
	"name" text,
	"last_message_preview" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_members_bot_id_idx" ON "chat_members" ("bot_id");--> statement-breakpoint
CREATE INDEX "chats_user_id_idx" ON "chats" ("user_id");--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_chat_id_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_bot_id_bots_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE;