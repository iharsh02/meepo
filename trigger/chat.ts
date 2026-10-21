import { chat } from "@trigger.dev/sdk/ai"
import { smoothStream } from "ai"

import { db } from "@/db"

// The bot's side of a chat, run durably on Trigger.dev. components/chat-view.tsx
// talks to it through useTriggerChatTransport; the conversation is kept in the
// platform's transcript storage under the chat id (a row in `chats`).
export const botChat = chat.agent({
  id: "bot-chat",
  run: async ({ chatId, messages, signal, streamText }) => {
    const found = await db.query.chats.findFirst({
      where: { id: chatId },
      with: { bots: true },
    })
    const bot = found?.bots[0]
    if (!bot) throw new Error(`No bot in chat ${chatId}`)

    return streamText({
      model: "minimax/minimax-m3.1-flash",
      instructions: [
        `You are ${bot.name}. Your job: ${bot.job}.`,
        bot.instructions,
      ]
        .filter(Boolean)
        .join("\n\n"),
      messages,
      abortSignal: signal,
      // Releases text word by word instead of in uneven provider chunks.
      experimental_transform: smoothStream(),
    })
  },
})
