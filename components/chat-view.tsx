"use client"

import { useEffect, useRef, useState, type ComponentProps } from "react"
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
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { BotFace } from "@/components/bot-face"
import {
  MentionText,
  MentionTextarea,
  mentionedBot,
  useMentionMenu,
  type MentionBot,
} from "@/components/bot-mentions"
import { ComposerMenu } from "@/components/composer-menu"
import { useReportContextUsage } from "@/components/context-usage"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
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
import { handOffIn, ownParts } from "@/lib/hand-off"
import type { botChat } from "@/trigger/chat"
import type { BotChatMessage } from "@/trigger/sandbox-tools"

// The conversation with a bot: its messages and the composer, filling the
// space under the chat page's header. Replies stream from the bot-chat agent
// in trigger/chat.ts, which keeps the history under `chatId`; it's loaded back
// on open. Key it by chat id so switching bots starts fresh. Pass a group
// chat's `bots` to @-mention them in the composer and show each reply's face.
export function ChatView({
  chatId,
  bots = [],
}: {
  chatId: string
  bots?: MentionBot[]
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
  bots: MentionBot[]
}) {
  // The bot that answers in a group chat: the one the person's message
  // @-mentions, else the last one mentioned (or handed a message). On load,
  // last saved speaker or recipient, else the oldest. Sent with each message
  // as metadata, read by trigger/chat.ts as `clientData.botId`, and saved on
  // the user message so it shows who the message went to.
  const [botId, setBotId] = useState(
    () =>
      initialMessages.findLast((message) =>
        bots.some((bot) => bot.id === message.metadata?.botId)
      )?.metadata?.botId ?? bots[0]?.id
  )

  function send(text: string) {
    const target = mentionedBot(text, bots)?.id ?? botId
    setBotId(target)
    const metadata = { botId: target }
    void sendMessage({ text, metadata }, { metadata })
  }

  // Handoffs already sent, by the id of the reply that made them, with how
  // many of its parts the next reply starts with. useChat starts a reply from
  // a copy of a trailing assistant message, but the agent sends a handed-over
  // answer as a new message, so that answer arrives with the handing-off
  // reply's parts in front; ownParts drops them. A handoff already in the
  // loaded transcript counts as sent, with nothing copied: its answer is there
  // or resuming.
  const [handOffs, setHandOffs] = useState<Record<string, number>>(() => {
    const last = initialMessages.at(-1)
    return last && handOffIn(last) ? { [last.id]: 0 } : {}
  })
  const { messages, sendMessage, regenerate, stop, status, error } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    resume: initialMessages.length > 0,
    // Only a successfully finished reply can start a handoff. Mounting with a
    // saved handoff, stopping, or losing the connection must not send one.
    onFinish: ({ messages, isAbort, isDisconnect, isError }) => {
      if (isAbort || isDisconnect || isError) return
      const last = messages.at(-1)
      const target = handOffIn(ownParts(messages, handOffs).at(-1))?.botId
      if (!last || !target || last.id in handOffs) return
      setHandOffs((sent) => ({ ...sent, [last.id]: last.parts.length }))
      setBotId(target)
      void sendMessage(undefined, {
        body: { action: { type: "handoff" } },
        metadata: { botId: target },
      })
    },
  })
  useReportContextUsage(messages)
  const busy = status === "submitted" || status === "streaming"
  const shown = ownParts(messages, handOffs)
  const activityLabel = busy ? activity(shown, status) : null

  // Regenerates the last reply as the current bot. A regenerated reply starts
  // empty, so if it follows a handoff, nothing needs dropping from it.
  function regenerateReply(messageId: string) {
    const previous = messages[messages.findIndex((m) => m.id === messageId) - 1]
    if (previous && previous.id in handOffs) {
      setHandOffs((sent) => ({ ...sent, [previous.id]: 0 }))
    }
    void regenerate({ messageId, metadata: { botId } })
  }

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
              {shown.map((message, index) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatMessage
                    message={message}
                    streaming={
                      status === "streaming" && index === shown.length - 1
                    }
                    bots={bots}
                    onRegenerate={
                      index === shown.length - 1 && !busy
                        ? () => regenerateReply(message.id)
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

      <Composer busy={busy} bots={bots} onSend={send} onStop={stopReply} />
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
  bots,
  streaming,
  onRegenerate,
}: {
  message: BotChatMessage
  bots: MentionBot[]
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
              {bots.length > 1 ? (
                <MentionText
                  text={text}
                  bots={bots}
                  sentTo={bots.find(
                    (bot) => bot.id === message.metadata?.botId
                  )}
                />
              ) : (
                text
              )}
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

  const speaker = speakerFor(message, bots)

  return (
    <Message className={speaker ? "items-start" : undefined}>
      {speaker && <BotFace seed={speaker.avatar} className="mt-0.5 size-6" />}
      <MessageContent className="gap-3">
        {speaker && (
          <span className="text-sm leading-5 font-medium">{speaker.name}</span>
        )}
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

// The bot that wrote an assistant reply, in a group of two or more. Direct
// chats pass no bots, so their replies stay unlabeled. A bot that has since
// left still shows, from the name and face saved on the message.
function speakerFor(message: BotChatMessage, bots: MentionBot[]) {
  if (bots.length < 2 || message.role !== "assistant") return undefined
  const id = message.metadata?.botId
  const known = id ? bots.find((bot) => bot.id === id) : undefined
  if (known) return known
  const name = message.metadata?.botName
  if (!name) return undefined
  return {
    id: id ?? name,
    name,
    avatar: message.metadata?.botAvatar ?? name,
  }
}

// Enter sends, Shift+Enter adds a newline. While `busy` sending waits and the
// send button becomes Stop. In a group chat (two or more `bots`), typing "@"
// opens a list of the bots to mention (components/bot-mentions.tsx).
function Composer({
  busy,
  bots,
  onSend,
  onStop,
}: {
  busy: boolean
  bots: MentionBot[]
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState("")
  const textarea = useRef<HTMLTextAreaElement>(null)
  const mentions = useMentionMenu({
    bots,
    text,
    setText,
    textarea: () => textarea.current,
  })

  function send() {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed)
    setText("")
  }

  return (
    <form
      className="relative mx-auto w-full max-w-3xl shrink-0 px-6 pt-2 pb-4"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      {mentions.menu}
      <InputGroup className="h-auto dark:bg-input/80">
        <MentionTextarea
          bots={bots}
          ref={textarea}
          placeholder={
            bots.length > 1
              ? "Message the group, type @ to pick a bot"
              : "What would you like to know?"
          }
          className="max-h-48 min-h-10"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            mentions.trackCaret(event.target, true)
          }}
          onSelect={(event) => mentions.trackCaret(event.currentTarget, false)}
          onKeyDown={(event) => {
            if (mentions.onKeyDown(event)) return
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <InputGroupAddon align="block-end" className="px-2 pb-2.5">
          <ComposerMenu />
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
