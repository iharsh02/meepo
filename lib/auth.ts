import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { db } from "@/db"
import * as schema from "@/db/schema"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
})

export type SessionUser = typeof auth.$Infer.Session.user

// Current session for server components, deduped per request. Null when signed out.
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() })
)

// Use in server components that need a signed-in user; redirects to /sign-in otherwise.
export async function requireUser() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  return session.user
}
