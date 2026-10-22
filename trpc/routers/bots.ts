import { TRPCError } from "@trpc/server"
import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { bots, chatMembers, chats } from "@/db/schema"
import { botInsertSchema } from "@/db/validation"
import { createSandbox, deleteSandbox } from "@/lib/daytona"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"

// Bots are always scoped to the signed-in user.
export const botsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(bots)
      .where(eq(bots.userId, ctx.user.id))
      .orderBy(desc(bots.createdAt))
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [bot] = await ctx.db
        .select()
        .from(bots)
        .where(and(eq(bots.id, input.id), eq(bots.userId, ctx.user.id)))
      return bot ?? null
    }),

  // Every bot gets its own Daytona sandbox. It's created first, so a bot row
  // never exists without one; if saving the bot then fails, the sandbox is
  // deleted again.
  create: protectedProcedure
    .input(botInsertSchema)
    .mutation(async ({ ctx, input }) => {
      const sandboxId = await createSandbox().catch((cause) => {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't set up the bot's sandbox. Try again.",
          cause,
        })
      })

      const [bot] = await ctx.db
        .insert(bots)
        .values({ ...input, userId: ctx.user.id, sandboxId })
        .returning()
        .catch(async (error) => {
          await deleteSandbox(sandboxId).catch(() => {})
          throw error
        })
      if (!bot) {
        await deleteSandbox(sandboxId).catch(() => {})
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't create the bot." })
      }
      return bot
    }),

  // Deletes one of the user's bots, its sandbox and its direct chats. The
  // sandbox goes first, so if Daytona fails the bot is still there to retry.
  // The chats' saved conversations stay in Trigger.dev's transcript storage.
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [bot] = await ctx.db
        .select({ id: bots.id, sandboxId: bots.sandboxId })
        .from(bots)
        .where(and(eq(bots.id, input.id), eq(bots.userId, ctx.user.id)))
      if (!bot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That bot doesn't exist." })
      }

      if (bot.sandboxId) {
        await deleteSandbox(bot.sandboxId).catch((cause) => {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't delete the bot's sandbox. Try again.",
            cause,
          })
        })
      }
      await ctx.db.transaction(async (tx) => {
        const direct = await tx
          .select({ id: chats.id })
          .from(chats)
          .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
          .where(and(eq(chats.kind, "direct"), eq(chatMembers.botId, bot.id)))
        if (direct.length) {
          await tx.delete(chats).where(
            inArray(
              chats.id,
              direct.map((chat) => chat.id)
            )
          )
        }
        await tx.delete(bots).where(eq(bots.id, bot.id))
      })
    }),
})
