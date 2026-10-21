import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

import { getSession } from "@/lib/auth"
import { caller } from "@/trpc/server"

// Streams one reply from the bot. useChat in components/chat-view.tsx posts the
// whole conversation plus the bot's id; nothing is saved.
export async function POST(req: Request) {
  if (!(await getSession()))
    return new Response("Unauthorized", { status: 401 })

  const { messages, botId }: { messages: UIMessage[]; botId: string } =
    await req.json()
  const bot = await caller.bots.byId({ id: botId })
  if (!bot) return new Response("Bot not found", { status: 404 })

  const result = streamText({
    model: "minimax/minimax-m3.1-flash",
    instructions: [
      `You are ${bot.name}. Your job: ${bot.job}.`,
      bot.instructions,
    ]
      .filter(Boolean)
      .join("\n\n"),
    messages: await convertToModelMessages(messages),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
