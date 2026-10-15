import { createTRPCRouter } from "@/trpc/init"
import { botsRouter } from "@/trpc/routers/bots"

export const appRouter = createTRPCRouter({
  bots: botsRouter,
})

export type AppRouter = typeof appRouter
