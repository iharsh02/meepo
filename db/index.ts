import { drizzle } from "drizzle-orm/node-postgres"

import { relations } from "@/db/schema"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set")
}

// Server-only Drizzle client over a node-postgres pool.
export const db = drizzle(process.env.DATABASE_URL, { relations })
