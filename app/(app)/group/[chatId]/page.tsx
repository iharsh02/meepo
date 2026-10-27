import { notFound } from "next/navigation"

import { ChatView } from "@/components/chat-view"
import { ChatsHeader } from "@/components/chats-header"
import { ContextUsageProvider } from "@/components/context-usage"
import { caller } from "@/trpc/server"

// A group chat: the header, with the group's avatar and name, over the
// conversation, whose composer picks which bot answers. Each bot has its own
// desktop, so there's no workspace panel.
export default async function GroupChatPage({
  params,
}: PageProps<"/group/[chatId]">) {
  const { chatId } = await params
  const chat = await caller.chats.groupById({ id: chatId })
  if (!chat) notFound()

  return (
    <ContextUsageProvider key={chat.id}>
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <ChatsHeader name={chat.name ?? "Group chat"} bots={chat.bots} />
        <ChatView key={chat.id} chatId={chat.id} bots={chat.bots} />
      </div>
    </ContextUsageProvider>
  )
}
