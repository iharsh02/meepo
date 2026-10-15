import { initTRPC, TRPCError } from "@trpc/server"
import { cache } from "react"

import { db } from "@/db"
import { getSession } from "@/lib/auth"

// Per-request context: the db and the Better Auth session (null when signed out).
export const createTRPCContext = cache(async () => ({
  db,
  session: await getSession(),
}))

const t = initTRPC
  .context<Awaited<ReturnType<typeof createTRPCContext>>>()
  .create()

export const createTRPCRouter = t.router
export const createCallerFactory = t.createCallerFactory
export const baseProcedure = t.procedure

// Rejects signed-out callers and puts the signed-in user on `ctx.user`.
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" })
  return next({ ctx: { ...ctx, user: ctx.session.user } })
})
