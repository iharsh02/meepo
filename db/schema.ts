import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { nanoid } from "nanoid"

export const bots = pgTable(
  "bots",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Owner's id from the auth provider; not a foreign key.
    userId: text("user_id").notNull(),
    name: text().notNull(),
    // Seed for the bot's DiceBear face.
    avatar: text()
      .notNull()
      .$defaultFn(() => nanoid()),
    // What the bot is for, in a phrase.
    job: text().notNull(),
    // How it should go about the job.
    instructions: text(),
    // Sandbox provider's id, created lazily the first time the bot needs one.
    sandboxId: text("sandbox_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("bots_user_id_idx").on(t.userId)]
)

export type Bot = typeof bots.$inferSelect
