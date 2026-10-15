"use server"

import { TRPCError } from "@trpc/server"
import { refresh } from "next/cache"

import type { BotInsert } from "@/db/validation"
import { caller } from "@/trpc/server"

// Creates a bot for the signed-in user via tRPC (which validates the input
// and reads the user id from the Better Auth session), then refreshes the
// page so the sidebar shows it. Returns an error message instead of throwing
// so the form can display it.
export async function createBotAction(input: BotInsert) {
  try {
    const bot = await caller.bots.create(input)
    refresh()
    return { botId: bot.id }
  } catch (error) {
    if (error instanceof TRPCError) return { error: error.message }
    throw error
  }
}
