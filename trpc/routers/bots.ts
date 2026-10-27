import { TRPCError } from "@trpc/server"
import { and, count, desc, eq, inArray, sql } from "drizzle-orm"
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
        // The same advisory lock openDirect takes, then the bot row, so a
        // chat can't be created for this bot until the delete commits.
        // Advisory first: the row lock conflicts with the foreign-key share
        // lock an insert needs, and taking them in the other order deadlocks.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${bot.id}))`)
        const [locked] = await tx
          .select({ id: bots.id })
          .from(bots)
          .where(eq(bots.id, bot.id))
          .for("update")
        if (!locked) return

        const memberships = await tx
          .select({ id: chats.id, kind: chats.kind })
          .from(chatMembers)
          .innerJoin(chats, eq(chats.id, chatMembers.chatId))
          .where(eq(chatMembers.botId, bot.id))
        const directIds = memberships
          .filter((chat) => chat.kind === "direct")
          .map((chat) => chat.id)
        if (directIds.length) {
          await tx.delete(chats).where(inArray(chats.id, directIds))
        }
        await tx.delete(bots).where(eq(bots.id, bot.id))

        // Groups this bot just left, and any already emptied by an earlier
        // delete, which no longer have a membership row to find them by.
        const groups = await tx
          .select({ id: chats.id })
          .from(chats)
          .where(and(eq(chats.userId, ctx.user.id), eq(chats.kind, "group")))
        if (!groups.length) return
        const tallies = await tx
          .select({
            chatId: chatMembers.chatId,
            members: count(),
          })
          .from(chatMembers)
          .where(
            inArray(
              chatMembers.chatId,
              groups.map((group) => group.id)
            )
          )
          .groupBy(chatMembers.chatId)
        const kept = new Set(
          tallies
            .filter((row) => Number(row.members) >= 2)
            .map((row) => row.chatId)
        )
        const undersized = groups
          .map((group) => group.id)
          .filter((id) => !kept.has(id))
        if (undersized.length) {
          await tx
            .delete(chats)
            .where(
              and(eq(chats.userId, ctx.user.id), inArray(chats.id, undersized))
            )
        }
      })
    }),
})
