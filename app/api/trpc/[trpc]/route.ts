import { fetchRequestHandler } from "@trpc/server/adapters/fetch"

import { createTRPCContext } from "@/trpc/init"
import { appRouter } from "@/trpc/routers/_app"

// HTTP endpoint for the same router, for client-side tRPC calls.
function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  })
}

export { handler as GET, handler as POST }
