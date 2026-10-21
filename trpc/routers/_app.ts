import { createTRPCRouter } from "@/trpc/init"
import { botsRouter } from "@/trpc/routers/bots"
import { chatsRouter } from "@/trpc/routers/chats"

export const appRouter = createTRPCRouter({
  bots: botsRouter,
  chats: chatsRouter,
})

export type AppRouter = typeof appRouter
