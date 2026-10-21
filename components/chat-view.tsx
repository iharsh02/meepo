"use client"

import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import type { TriggerChatTransport } from "@trigger.dev/sdk/chat"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import type { UIMessage } from "ai"
import {
  CheckIcon,
  CopyIcon,
  CornerDownLeftIcon,
  MonitorIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react"

import {
  loadChatTranscript,
  mintChatAccessToken,
  startChatSession,
} from "@/app/(app)/chat/actions"
import {
  MessageAction,
  MessageActions,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { BotFace, type BotFaceColors } from "@/components/bot-face"
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
import { Spinner } from "@/components/ui/spinner"
import type { Bot } from "@/db/schema"
import type { botChat } from "@/trigger/chat"

// One conversation with a bot, plus the toggleable workspace panel that shows
// the bot's desktop. Replies stream from the bot-chat agent in trigger/chat.ts,
// which keeps the history under `chatId`; it's loaded back on open. Key it by
// chat id so switching bots starts fresh. `faceColors` tints the user's
// messages to match the bot's face (null falls back to neutral).
export function ChatView({
  bot,
  chatId,
  faceColors,
}: {
  bot: Bot
  chatId: string
  faceColors: BotFaceColors | null
}) {
  const transport = useTriggerChatTransport<typeof botChat>({
    task: "bot-chat",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId }) => startChatSession({ chatId }),
  })
  const transcript = useLoadTranscript(chatId, loadChatTranscript, {
    transport,
  })
  const [workspaceOpen, setWorkspaceOpen] = useState(false)

  return (
    <div className="flex h-svh min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
          <SidebarTrigger className="md:hidden" />
          <div className="flex h-7 items-center gap-1 rounded-md pr-2.5 pl-1.5 text-[13px] font-medium">
            <BotFace seed={bot.avatar} className="size-5" />
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

        {transcript.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : transcript.error ? (
          <p className="flex-1 pt-8 text-center text-sm text-destructive">
            Couldn&apos;t load this chat. Try reloading the page.
          </p>
        ) : (
          <Conversation
            chatId={chatId}
            transport={transport}
            initialMessages={transcript.messages}
            faceColors={faceColors}
          />
        )}
      </div>

      {workspaceOpen && <WorkspacePanel botName={bot.name} />}
    </div>
  )
}

// The messages and composer. Mounted once the transcript has loaded, because
// useChat only reads its initial messages on mount.
function Conversation({
  chatId,
  transport,
  initialMessages,
  faceColors,
}: {
  chatId: string
  transport: TriggerChatTransport
  initialMessages: UIMessage[]
  faceColors: BotFaceColors | null
}) {
  const { messages, sendMessage, regenerate, status, error } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
  })
  const busy = status === "submitted" || status === "streaming"

  return (
    <>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-8 px-6 py-6">
              {messages.map((message, index) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatMessage
                    message={message}
                    faceColors={faceColors}
                    streaming={
                      status === "streaming" && index === messages.length - 1
                    }
                    onRegenerate={
                      index === messages.length - 1 && !busy
                        ? () => regenerate({ messageId: message.id })
                        : undefined
                    }
                  />
                </MessageScrollerItem>
              ))}
              {error && (
                <p className="text-center text-sm text-destructive">
                  Something went wrong. Try sending that again.
                </p>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <Composer busy={busy} onSend={(text) => sendMessage({ text })} />
    </>
  )
}

// The user's messages are right-aligned pills in the bot's face colours; the
// bot's replies are plain
// full-width markdown with copy (and, on the latest reply, regenerate) below.
// `streaming` is true for the reply currently arriving. The model's reasoning,
// when it sends any, shows above the reply and counts as thinking until the
// first words of the answer arrive.
function ChatMessage({
  message,
  faceColors,
  streaming,
  onRegenerate,
}: {
  message: UIMessage
  faceColors: BotFaceColors | null
  streaming: boolean
  onRegenerate?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
  const reasoning = message.parts
    .map((part) => (part.type === "reasoning" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n")

  if (message.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble variant="secondary" align="end">
            <BubbleContent
              className="rounded-3xl px-5 py-3 text-[15px] leading-6 whitespace-pre-wrap"
              style={
                faceColors
                  ? { backgroundColor: faceColors.body, color: faceColors.ink }
                  : undefined
              }
            >
              {text}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Message>
      <MessageContent className="gap-3">
        {reasoning && (
          <Reasoning isStreaming={streaming && !text}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoning}</ReasoningContent>
          </Reasoning>
        )}
        {text && (
          <MessageResponse
            animated
            isAnimating={streaming}
            className="text-[15px] leading-7 text-foreground"
          >
            {text}
          </MessageResponse>
        )}
        {text && !streaming && (
          <MessageActions className="-ml-2 text-muted-foreground">
            <MessageAction label={copied ? "Copied" : "Copy"} onClick={copy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </MessageAction>
            {onRegenerate && (
              <MessageAction label="Regenerate" onClick={onRegenerate}>
                <RefreshCwIcon />
              </MessageAction>
            )}
          </MessageActions>
        )}
      </MessageContent>
    </Message>
  )
}

// Enter sends, Shift+Enter adds a newline. Sending waits while `busy`.
function Composer({
  busy,
  onSend,
}: {
  busy: boolean
  onSend: (text: string) => void
}) {
  const [text, setText] = useState("")

  function send() {
    const trimmed = text.trim()
    if (!trimmed || busy) return
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
            disabled={!text.trim() || busy}
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
