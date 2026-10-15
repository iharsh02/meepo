import { createCallerFactory, createTRPCContext } from "@/trpc/init"
import { appRouter } from "@/trpc/routers/_app"

// Calls tRPC procedures directly from server components and server actions,
// with no HTTP round trip: `await caller.bots.list()`.
export const caller = createCallerFactory(appRouter)(createTRPCContext)
