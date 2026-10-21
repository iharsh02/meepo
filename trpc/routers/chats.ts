import { TRPCError } from "@trpc/server"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { bots, chatMembers, chats } from "@/db/schema"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"

// Chats are always scoped to the signed-in user.
export const chatsRouter = createTRPCRouter({
  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [chat] = await ctx.db
        .select()
        .from(chats)
        .where(and(eq(chats.id, input.id), eq(chats.userId, ctx.user.id)))
      return chat ?? null
    }),

  // The direct chat with one of the user's bots, created on first open.
  // Returns null when the bot isn't theirs.
  openDirect: protectedProcedure
    .input(z.object({ botId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [bot] = await ctx.db
        .select({ id: bots.id })
        .from(bots)
        .where(and(eq(bots.id, input.botId), eq(bots.userId, ctx.user.id)))
      if (!bot) return null

      const [existing] = await ctx.db
        .select({ id: chats.id })
        .from(chats)
        .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
        .where(and(eq(chats.kind, "direct"), eq(chatMembers.botId, bot.id)))
      if (existing) return existing

      return ctx.db.transaction(async (tx) => {
        const [chat] = await tx
          .insert(chats)
          .values({ userId: ctx.user.id })
          .returning({ id: chats.id })
        if (!chat) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't open the chat.",
          })
        }
        await tx.insert(chatMembers).values({ chatId: chat.id, botId: bot.id })
        return chat
      })
    }),
})
