"use server"

import { auth } from "@trigger.dev/sdk"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { validateUIMessages } from "ai"

import { caller } from "@/trpc/server"
import type { botChat } from "@/trigger/chat"
import type { BotChatMessage } from "@/trigger/sandbox-tools"

const startSession = chat.createStartSessionAction<typeof botChat>("bot-chat")
const loadTranscript = chat.createLoadTranscriptAction(defaultStorage)

// The chat id comes from the browser, so every action checks the signed-in
// user owns the chat before touching Trigger.dev.
async function assertOwnsChat(chatId: string) {
  if (!(await caller.chats.byId({ id: chatId }))) {
    throw new Error("Chat not found")
  }
}

// Called by useTriggerChatTransport on the first message of a chat (and again
// when it has no token). Idempotent per chat id.
export async function startChatSession({ chatId }: { chatId: string }) {
  await assertOwnsChat(chatId)
  return startSession({ chatId })
}

// Called by useTriggerChatTransport to refresh an expired token.
export async function mintChatAccessToken(chatId: string) {
  await assertOwnsChat(chatId)
  return auth.createPublicToken({
    scopes: { read: { sessions: chatId }, write: { sessions: chatId } },
    expirationTime: "1h",
  })
}

// Called by useLoadTranscript to show a chat's history on page load. The
// stored messages come back untyped, so they're checked against the UI message
// shape before the chat renders them as BotChatMessages. The validator rejects
// an empty list (a new chat) and empty messages (a reply stopped before it
// began), so those are left out first.
export async function loadChatTranscript(params: {
  chatId: string
  limit?: number
}) {
  await assertOwnsChat(params.chatId)
  const transcript = await loadTranscript(params)
  const stored = transcript.messages.filter((message) => message.parts.length)
  const messages = stored.length
    ? await validateUIMessages<BotChatMessage>({ messages: stored })
    : []
  return { ...transcript, messages }
}
