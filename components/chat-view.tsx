"use client"

import { useEffect, useState, type ComponentProps, type ReactNode } from "react"
import { useChat } from "@ai-sdk/react"
import type { TriggerChatTransport } from "@trigger.dev/sdk/chat"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import { isStaticToolUIPart, type ChatStatus } from "ai"
import {
  CheckIcon,
  CornerDownLeftIcon,
  RefreshCwIcon,
  SquareIcon,
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
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { BotFace } from "@/components/bot-face"
import { ComposerMenu } from "@/components/composer-menu"
import { useReportContextUsage } from "@/components/context-usage"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
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
import { Spinner } from "@/components/ui/spinner"
import { ToolCall, toolActivity } from "@/components/tool-call"
import type { Bot } from "@/db/schema"
import type { botChat } from "@/trigger/chat"
import type { BotChatMessage } from "@/trigger/sandbox-tools"

// The conversation with a bot: its messages and the composer, filling the
// space under the chat page's header. Replies stream from the bot-chat agent
// in trigger/chat.ts, which keeps the history under `chatId`; it's loaded back
// on open. Key it by chat id so switching bots starts fresh. Pass a group
// chat's `bots` to show a picker in the composer for which bot answers.
export function ChatView({
  chatId,
  bots = [],
}: {
  chatId: string
  bots?: ChatBot[]
}) {
  const transport = useTriggerChatTransport<typeof botChat>({
    task: "bot-chat",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId }) => startChatSession({ chatId }),
  })
  const transcript = useLoadTranscript<BotChatMessage>(
    chatId,
    async (params) => {
      const transcript = await loadChatTranscript(params)
      if (transcript.messages.length) {
        const publicAccessToken = await mintChatAccessToken(params.chatId)
        if (!transport.getSession(params.chatId)) {
          transport.setSession(params.chatId, { publicAccessToken })
        }
      }
      return transcript
    },
    {
      transport,
    }
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
          bots={bots}
        />
      )}
    </div>
  )
}

// The messages and composer. Mounted once the transcript has loaded, because
// useChat only reads its initial messages on mount. The loader restores the
// session and seeds its transcript cursor before useChat resumes the stream.
function Conversation({
  chatId,
  transport,
  initialMessages,
  bots,
}: {
  chatId: string
  transport: TriggerChatTransport
  initialMessages: BotChatMessage[]
  bots: ChatBot[]
}) {
  const { messages, sendMessage, regenerate, stop, status, error } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    resume: initialMessages.length > 0,
  })
  useReportContextUsage(messages)
  const busy = status === "submitted" || status === "streaming"
  const activityLabel = busy ? activity(messages, status) : null
  // The bot that answers the next message in a group chat, sent with each
  // message as metadata and read by trigger/chat.ts as `clientData.botId`.
  const [botId, setBotId] = useState(bots[0]?.id)
  const metadata = { botId }

  // Stops the reply: stop() ends the stream on screen, and stopGeneration()
  // tells the agent to stop this turn even when the stream was resumed after a
  // reload. The agent's run stays alive for the next message. This is the order
  // Trigger.dev's docs use.
  function stopReply() {
    stop()
    transport.stopGeneration(chatId)
  }

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
                    streaming={
                      status === "streaming" && index === messages.length - 1
                    }
                    onRegenerate={
                      index === messages.length - 1 && !busy
                        ? () => regenerate({ messageId: message.id, metadata })
                        : undefined
                    }
                  />
                </MessageScrollerItem>
              ))}
              {activityLabel && (
                <Shimmer duration={1.5} className="text-sm">
                  {`${activityLabel}…`}
                </Shimmer>
              )}
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

      <Composer
        busy={busy}
        onSend={(text) => sendMessage({ text }, { metadata })}
        onStop={stopReply}
      >
        {bots.length > 1 && botId && (
          <BotPicker bots={bots} value={botId} onChange={setBotId} />
        )}
      </Composer>
    </>
  )
}

// What the agent is doing right now, for the status line under the reply:
// the tool it's running, "Writing" while text streams, else "Thinking". Null
// while the thinking header already shimmers its own "Thinking…", and once
// the reply's last text has finished (the turn is wrapping up).
function activity(messages: BotChatMessage[], status: ChatStatus) {
  const last = messages.at(-1)
  if (status === "submitted" || last?.role !== "assistant") return "Thinking"
  const part = last.parts.at(-1)
  if (part?.type === "reasoning") {
    return part.state === "streaming" ? null : "Thinking"
  }
  if (part?.type === "text") {
    return part.state === "streaming" ? "Writing" : null
  }
  if (
    part &&
    isStaticToolUIPart(part) &&
    (part.state === "input-streaming" || part.state === "input-available")
  ) {
    return toolActivity(part)
  }
  return "Thinking"
}

// The user's messages are right-aligned grey boxes; the bot's replies are plain full-width markdown with copy (and, on
// the latest reply, regenerate) below.
// A reply renders its parts in order: thinking, text and tool calls
// (components/tool-call.tsx). `streaming` is true for the reply currently
// arriving; its actions appear once it's done.
function ChatMessage({
  message,
  streaming,
  onRegenerate,
}: {
  message: BotChatMessage
  streaming: boolean
  onRegenerate?: () => void
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n")

  if (message.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble variant="secondary" align="end">
            <BubbleContent className="rounded-xl px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap text-foreground">
              {text}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  // The check icon reverts after 2 seconds. Copying can fail when the browser
  // denies clipboard access; the button then just stays as it was.
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {}
  }

  return (
    <Message>
      <MessageContent className="gap-3">
        {message.parts.map((part, index) => {
          if (part.type === "reasoning" && part.text) {
            return (
              <Reasoning key={index} isStreaming={part.state === "streaming"}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            )
          }
          if (part.type === "text" && part.text) {
            return (
              <MessageResponse
                key={index}
                animated
                isAnimating={part.state === "streaming"}
                className="text-[15px] leading-7 text-foreground"
              >
                {part.text}
              </MessageResponse>
            )
          }
          if (isStaticToolUIPart(part))
            return <ToolCall key={index} part={part} />
          return null
        })}
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

type ChatBot = Pick<Bot, "id" | "name" | "avatar">

// Enter sends, Shift+Enter adds a newline. While `busy` sending waits and the
// send button becomes Stop. `children` sit in the toolbar after the menu.
function Composer({
  busy,
  onSend,
  onStop,
  children,
}: {
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
  children?: ReactNode
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
      className="mx-auto w-full max-w-3xl shrink-0 px-6 pt-2 pb-4"
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
          <ComposerMenu />
          {children}
          {busy ? (
            <InputGroupButton
              type="button"
              variant="default"
              size="icon-sm"
              className="ml-auto rounded-lg"
              onClick={onStop}
            >
              <SquareIcon className="fill-current" />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          ) : (
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
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

// The composer's dropdown for which bot in a group chat answers next.
function BotPicker({
  bots,
  value,
  onChange,
}: {
  bots: ChatBot[]
  value: string
  onChange: (botId: string) => void
}) {
  return (
    <PromptInputSelect
      value={value}
      onValueChange={(id) => {
        if (typeof id === "string") onChange(id)
      }}
    >
      <PromptInputSelectTrigger size="sm" aria-label="Bot to answer">
        <PromptInputSelectValue>
          {(id: string) => {
            const bot = bots.find((bot) => bot.id === id)
            return (
              bot && (
                <span className="flex items-center gap-1.5">
                  <BotFace seed={bot.avatar} className="size-4" />
                  {bot.name}
                </span>
              )
            )
          }}
        </PromptInputSelectValue>
      </PromptInputSelectTrigger>
      <PromptInputSelectContent>
        {bots.map((bot) => (
          <PromptInputSelectItem key={bot.id} value={bot.id}>
            <BotFace seed={bot.avatar} className="size-4" />
            {bot.name}
          </PromptInputSelectItem>
        ))}
      </PromptInputSelectContent>
    </PromptInputSelect>
  )
}

// Copy icon in Lucide's style (24px grid, stroke 2, round joins), drawn so the
// back sheet's edges run into the front sheet. Lucide's own `Copy` leaves gaps
// that look chopped at 16px.
function CopyIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" />
    </svg>
  )
}
