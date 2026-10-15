"use client"

import { useState } from "react"
import { CornerDownLeftIcon, MonitorIcon, PlusIcon, RefreshCwIcon } from "lucide-react"

import { BotFace } from "@/components/bot-face"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { SidebarTrigger } from "@/components/ui/sidebar"
import type { Bot } from "@/db/schema"

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
}

// One conversation with a bot, plus the toggleable workspace panel that shows
// the bot's desktop. Messages are local state until the AI SDK is wired in.
export function ChatView({
  bot,
  initialMessages,
}: {
  bot: Bot
  initialMessages: ChatMessage[]
}) {
  const [messages, setMessages] = useState(initialMessages)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)

  return (
    <div className="flex h-svh min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
          <SidebarTrigger className="md:hidden" />
          <div className="flex h-7 items-center gap-1 rounded-md pr-2.5 pl-1.5 text-[13px] font-medium">
            <BotFace seed={bot.faceSeed} className="size-5" />
            {bot.name}
          </div>
          <Button
            variant={workspaceOpen ? "secondary" : "ghost"}
            size="icon-sm"
            className="ml-auto rounded-md"
            aria-pressed={workspaceOpen}
            onClick={() => setWorkspaceOpen((open) => !open)}
          >
            <MonitorIcon />
            <span className="sr-only">
              {workspaceOpen ? "Close workspace" : "Open workspace"}
            </span>
          </Button>
        </header>

        <MessageScrollerProvider autoScroll>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-8 px-6 py-4">
                {messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <ChatBubble message={message} />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>

        <Composer
          onSend={(text) =>
            setMessages((current) => [
              ...current,
              { id: crypto.randomUUID(), role: "user", text },
            ])
          }
        />
      </div>

      {workspaceOpen && <WorkspacePanel botName={bot.name} />}
    </div>
  )
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const fromUser = message.role === "user"

  return (
    <Message align={fromUser ? "end" : "start"}>
      <MessageContent>
        <Bubble
          variant="secondary"
          align={fromUser ? "end" : "start"}
          className={fromUser ? "*:data-[slot=bubble-content]:bg-neutral-700" : undefined}
        >
          <BubbleContent className="rounded-[22px] py-2.5 leading-5">
            {message.text}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

// Enter sends, Shift+Enter adds a newline.
function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("")

  function send() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText("")
  }

  return (
    <form
      className="shrink-0 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <InputGroup className="dark:bg-input/80">
        <InputGroupTextarea
          placeholder="What would you like to know?"
          className="max-h-48 min-h-10"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <InputGroupAddon align="block-end" className="px-2 pb-2.5">
          {/* Attachments aren't wired up yet. */}
          <InputGroupButton size="icon-sm" className="rounded-lg">
            <PlusIcon />
            <span className="sr-only">Attach</span>
          </InputGroupButton>
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-sm"
            className="ml-auto rounded-lg"
            disabled={!text.trim()}
          >
            <CornerDownLeftIcon />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

function WorkspacePanel({ botName }: { botName: string }) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l">
      <div className="flex h-10 shrink-0 items-center justify-end px-3">
        {/* Reconnects the VNC stream once it exists. */}
        <Button variant="ghost" size="icon-sm" className="rounded-md">
          <RefreshCwIcon />
          <span className="sr-only">Reconnect</span>
        </Button>
      </div>
      <div className="px-3 pt-3">
        <div className="flex h-[146px] justify-center overflow-hidden rounded-md border bg-card py-0.5">
          <DesktopPlaceholder />
        </div>
        <p className="mt-2.5 text-center text-xs text-muted-foreground">
          {botName}&apos;s screen
        </p>
      </div>
    </aside>
  )
}

// Stand-in for the noVNC canvas: a tiny drawing of a desktop.
function DesktopPlaceholder() {
  return (
    <div className="relative h-full w-[193px] bg-linear-[130deg] from-[#054d61] to-[#0d6b7a] to-62%">
      <div className="absolute inset-x-0 top-0 h-[5px] bg-neutral-200/85" />
      {[10, 26, 42].map((top) => (
        <div
          key={top}
          className="absolute left-2 size-2 rounded-[1px] bg-slate-200/80"
          style={{ top }}
        />
      ))}
      <div className="absolute bottom-px left-[60px] h-[7px] w-[73px] rounded-[1px] bg-slate-800" />
    </div>
  )
}
