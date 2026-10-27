import { defineRelations } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
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
    // The bot's Daytona sandbox, created with the bot and deleted with it
    // (lib/daytona.ts). Null only for bots made before sandboxes existed.
    sandboxId: text("sandbox_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("bots_user_id_idx").on(t.userId)]
)

export const chatKind = pgEnum("chat_kind", ["direct", "group"])

export const chats = pgTable(
  "chats",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Owner's id from the auth provider; not a foreign key.
    userId: text("user_id").notNull(),
    kind: chatKind().default("direct").notNull(),
    // Null for direct chats, which show the bot's name instead.
    name: text(),
    lastMessagePreview: text("last_message_preview"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("chats_user_id_idx").on(t.userId)]
)

// Which bots are in which chat. A direct chat has one row, a group has several.
export const chatMembers = pgTable(
  "chat_members",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.botId] }),
    index("chat_members_bot_id_idx").on(t.botId),
  ]
)

// Passed to drizzle() in db/index.ts so `db.query` can load a chat's bots
// (and a bot's chats) through chat_members.
export const relations = defineRelations({ bots, chats, chatMembers }, (r) => ({
  chats: {
    bots: r.many.bots({
      from: r.chats.id.through(r.chatMembers.chatId),
      to: r.bots.id.through(r.chatMembers.botId),
    }),
  },
  bots: {
    chats: r.many.chats({
      from: r.bots.id.through(r.chatMembers.botId),
      to: r.chats.id.through(r.chatMembers.chatId),
    }),
  },
}))

export type Bot = typeof bots.$inferSelect
export type Chat = typeof chats.$inferSelect
export type ChatWithBots = Chat & { bots: Bot[] }
