import { notFound } from "next/navigation"

import { ChatView } from "@/components/chat-view"
import { caller } from "@/trpc/server"

export default async function ChatPage({ params }: PageProps<"/chat/[botId]">) {
  const { botId } = await params
  const bot = await caller.bots.byId({ id: botId })
  if (!bot) notFound()

  return <ChatView key={bot.id} bot={bot} />
}
