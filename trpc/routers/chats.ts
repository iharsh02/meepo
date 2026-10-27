import { TRPCError } from "@trpc/server"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { bots, chatMembers, chats } from "@/db/schema"
import { groupChatInsertSchema } from "@/db/validation"
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

  // The user's group chats with their bots, newest first, for the sidebar.
  groups: protectedProcedure.query(({ ctx }) =>
    ctx.db.query.chats.findMany({
      where: { userId: ctx.user.id, kind: "group" },
      with: { bots: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    })
  ),

  // One of the user's group chats with its bots, or null when it isn't theirs.
  groupById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const chat = await ctx.db.query.chats.findFirst({
        where: { id: input.id, userId: ctx.user.id, kind: "group" },
        with: { bots: { orderBy: { createdAt: "asc" } } },
      })
      return chat ?? null
    }),

  // Creates a group chat with some of the user's bots. Rejects bot ids that
  // aren't theirs, so the browser can't add someone else's bot.
  createGroup: protectedProcedure
    .input(groupChatInsertSchema)
    .mutation(async ({ ctx, input }) => {
      const botIds = [...new Set(input.botIds)]
      const owned = await ctx.db
        .select({ id: bots.id })
        .from(bots)
        .where(and(inArray(bots.id, botIds), eq(bots.userId, ctx.user.id)))
      if (owned.length !== botIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Some of those bots don't exist anymore. Reopen the form.",
        })
      }

      return ctx.db.transaction(async (tx) => {
        const [chat] = await tx
          .insert(chats)
          .values({ userId: ctx.user.id, kind: "group", name: input.name })
          .returning({ id: chats.id })
        if (!chat) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't create the group.",
          })
        }
        await tx
          .insert(chatMembers)
          .values(botIds.map((botId) => ({ chatId: chat.id, botId })))
        return chat
      })
    }),

  // The direct chat with one of the user's bots, created on first open.
  // Returns null when the bot isn't theirs. Concurrent opens for the same bot
  // (two tabs, a prefetch) queue on an advisory lock, so only one gets created.
  openDirect: protectedProcedure
    .input(z.object({ botId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [bot] = await ctx.db
        .select({ id: bots.id })
        .from(bots)
        .where(and(eq(bots.id, input.botId), eq(bots.userId, ctx.user.id)))
      if (!bot) return null

      return ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${bot.id}))`)

        const [existing] = await tx
          .select({ id: chats.id })
          .from(chats)
          .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
          .where(
            and(
              eq(chats.userId, ctx.user.id),
              eq(chats.kind, "direct"),
              eq(chatMembers.botId, bot.id)
            )
          )
          .orderBy(asc(chats.createdAt))
          .limit(1)
        if (existing) return existing

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
