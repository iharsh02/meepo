import { TRPCError } from "@trpc/server"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { bots } from "@/db/schema"
import { botInsertSchema } from "@/db/validation"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"

// Bots are always scoped to the signed-in user.
export const botsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(bots)
      .where(eq(bots.userId, ctx.user.id))
      .orderBy(desc(bots.updatedAt))
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

  create: protectedProcedure
    .input(botInsertSchema)
    .mutation(async ({ ctx, input }) => {
      const [bot] = await ctx.db
        .insert(bots)
        .values({ ...input, userId: ctx.user.id })
        .returning()
      if (!bot) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't create the bot." })
      }
      return bot
    }),
})
