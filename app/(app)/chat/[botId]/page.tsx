import { notFound } from "next/navigation"

import { ChatView } from "@/components/chat-view"
import { caller } from "@/trpc/server"

export default async function ChatPage({ params }: PageProps<"/chat/[botId]">) {
  const { botId } = await params
  const bot = await caller.bots.byId({ id: botId })
  if (!bot) notFound()
  const chat = await caller.chats.openDirect({ botId: bot.id })
  if (!chat) notFound()

  return <ChatView key={chat.id} bot={bot} chatId={chat.id} />
}
