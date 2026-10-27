import { notFound } from "next/navigation"

import { AgentPanel } from "@/components/agent-panel"
import { ChatView } from "@/components/chat-view"
import { ChatsHeader, WorkspaceButton } from "@/components/chats-header"
import { ContextUsageProvider } from "@/components/context-usage"
import {
  SandboxScreenPreview,
  SandboxScreenProvider,
} from "@/components/sandbox-screen"
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { WorkspacePanel, WorkspaceProvider } from "@/components/workspace"
import { caller } from "@/trpc/server"

// A chat with one bot: the header and conversation on the left, and the
// workspace on the right (the bot's live desktop over its agent panel), which
// the header's desktop button toggles. The
// group fills the sidebar's <main>, which the layout pins to the viewport
// height, so only the messages scroll (MessageScroller in
// components/chat-view.tsx).
export default async function ChatPage({ params }: PageProps<"/chat/[botId]">) {
  const { botId } = await params
  const bot = await caller.bots.byId({ id: botId })
  if (!bot) notFound()
  const chat = await caller.chats.openDirect({ botId: bot.id })
  if (!chat) notFound()

  return (
    <WorkspaceProvider>
      <SandboxScreenProvider key={bot.id} botId={bot.id}>
        <ContextUsageProvider key={chat.id}>
          <ResizablePanelGroup>
            <ResizablePanel
              id="chat"
              minSize="40%"
              className="flex h-full min-w-0 flex-col"
              style={{ overflow: "hidden" }}
            >
              <ChatsHeader name={bot.name} bots={[bot]}>
                <WorkspaceButton />
              </ChatsHeader>
              <ChatView key={chat.id} chatId={chat.id} />
            </ResizablePanel>
            <WorkspacePanel>
              <SandboxScreenPreview botName={bot.name} />
              <AgentPanel bot={bot} />
            </WorkspacePanel>
          </ResizablePanelGroup>
        </ContextUsageProvider>
      </SandboxScreenProvider>
    </WorkspaceProvider>
  )
}
