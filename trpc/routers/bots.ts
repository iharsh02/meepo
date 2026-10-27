import { TRPCError } from "@trpc/server"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { bots, chatMembers, chats } from "@/db/schema"
import { botInsertSchema } from "@/db/validation"
import { createSandbox, deleteSandbox } from "@/lib/daytona"
import { deleteChatScreenshotFiles } from "@/lib/screenshot-files"
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
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't create the bot.",
        })
      }
      return bot
    }),

  // Saves the side panel's Configure form for one of the user's bots. Its
  // chats pick up the change from their next message (trigger/chat.ts).
  update: protectedProcedure
    .input(botInsertSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input: { id, ...values } }) => {
      const [bot] = await ctx.db
        .update(bots)
        .set(values)
        .where(and(eq(bots.id, id), eq(bots.userId, ctx.user.id)))
        .returning()
      if (!bot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That bot doesn't exist.",
        })
      }
      return bot
    }),

  // Deletes one of the user's bots, its sandbox, its direct chats, and any
  // group that would be left with fewer than two bots. The sandbox goes
  // first, so if Daytona fails the bot is still there to retry. The chats'
  // saved conversations stay in Trigger.dev's transcript storage.
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [bot] = await ctx.db
        .select({ id: bots.id, sandboxId: bots.sandboxId })
        .from(bots)
        .where(and(eq(bots.id, input.id), eq(bots.userId, ctx.user.id)))
      if (!bot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That bot doesn't exist.",
        })
      }

      const direct = await ctx.db
        .select({ id: chats.id })
        .from(chats)
        .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
        .where(and(eq(chats.kind, "direct"), eq(chatMembers.botId, bot.id)))
      if (bot.sandboxId) {
        await deleteChatScreenshotFiles(
          bot.sandboxId,
          direct.map((chat) => chat.id)
        ).catch((cause) => {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't delete the chat's screenshots. Try again.",
            cause,
          })
        })
        await deleteSandbox(bot.sandboxId).catch((cause) => {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't delete the bot's sandbox. Try again.",
            cause,
          })
        })
      }
      await ctx.db.transaction(async (tx) => {
        const groups = await tx
          .select({ id: chats.id })
          .from(chats)
          .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
          .where(and(eq(chats.kind, "group"), eq(chatMembers.botId, bot.id)))
        if (direct.length) {
          await tx.delete(chats).where(
            inArray(
              chats.id,
              direct.map((chat) => chat.id)
            )
          )
        }
        await tx.delete(bots).where(eq(bots.id, bot.id))
        // Its groups lost a member with it (chat_members cascades). Delete any
        // left with fewer than two bots.
        for (const group of groups) {
          const [{ members = 0 } = {}] = await tx
            .select({ members: count() })
            .from(chatMembers)
            .where(eq(chatMembers.chatId, group.id))
          if (members < 2) await tx.delete(chats).where(eq(chats.id, group.id))
        }
      })
    }),
})
