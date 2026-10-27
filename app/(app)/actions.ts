"use server"

import { TRPCError } from "@trpc/server"
import { refresh, revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import type { BotInsert, GroupChatInsert } from "@/db/validation"
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

// Creates a group chat for the signed-in user via tRPC (which validates the
// input and checks the bots are theirs), then refreshes the page so the
// sidebar shows it. Returns an error message instead of throwing so the form
// can display it.
export async function createGroupChatAction(input: GroupChatInsert) {
  try {
    const chat = await caller.chats.createGroup(input)
    refresh()
    return { chatId: chat.id }
  } catch (error) {
    if (error instanceof TRPCError) return { error: error.message }
    throw error
  }
}

// Saves changes to one of the signed-in user's bots via tRPC, then refreshes
// the page so the header, sidebar and side panel show them. Returns an error
// message instead of throwing so the form can display it.
export async function updateBotAction(botId: string, input: BotInsert) {
  try {
    await caller.bots.update({ ...input, id: botId })
    refresh()
    return {}
  } catch (error) {
    if (error instanceof TRPCError) return { error: error.message }
    throw error
  }
}

// Deletes one of the signed-in user's bots, and its sandbox, via tRPC, then
// goes home with the sidebar refreshed to drop it (called from the bot's own
// chat page, which no longer exists). Returns an error message instead of
// throwing.
export async function deleteBotAction(botId: string) {
  try {
    await caller.bots.delete({ id: botId })
  } catch (error) {
    if (error instanceof TRPCError) return { error: error.message }
    throw error
  }
  revalidatePath("/", "layout")
  redirect("/")
}
