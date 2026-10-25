import { createInsertSchema } from "drizzle-orm/zod"
import type { z } from "zod"

import { bots } from "@/db/schema"

// What a user sends to create a bot. Generated from the `bots` table, then
// narrowed to user-editable fields; `id`, `userId` and `sandboxId` are set on
// the server. Shared by the New bot form (client) and bots.create (server).
export const botInsertSchema = createInsertSchema(bots, {
  name: (schema) =>
    schema
      .trim()
      .min(1, "Give your bot a name.")
      .max(50, "Keep the name under 50 characters."),
  job: (schema) =>
    schema
      .trim()
      .min(1, "Say what the bot is for.")
      .max(80, "Keep the job under 80 characters."),
  instructions: (schema) =>
    schema
      .trim()
      .max(2000, "Keep the instructions under 2000 characters.")
      .transform((value) => value || null),
  avatar: (schema) => schema.min(1).max(64),
}).pick({ name: true, job: true, instructions: true, avatar: true })

export type BotInsert = z.input<typeof botInsertSchema>
