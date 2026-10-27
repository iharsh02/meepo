import { chat } from "@trigger.dev/sdk/ai"
import { asSchema, isStepCount, smoothStream } from "ai"
import { z } from "zod"

import { db } from "@/db"
import type { Bot } from "@/db/schema"
import { botNotInGroupMessage, emptyGroupMessage } from "@/lib/chat-errors"
import { attributeOtherBots } from "@/trigger/group-messages"
import {
  activeChat,
  botSandbox,
  loadScreenshots,
  sandboxTools,
  type BotChatMessage,
  type ContextUsage,
} from "@/trigger/sandbox-tools"
import { prepareAgentStep } from "@/trigger/prepare-step"

type SandboxToolName = keyof typeof sandboxTools

const toolsExceptScreen = (
  Object.keys(sandboxTools) as SandboxToolName[]
).filter(
  (name): name is Exclude<SandboxToolName, "viewScreen" | "showScreen"> =>
    name !== "viewScreen" && name !== "showScreen"
)

// Who is answering this turn, and the other members when it's a group. Set in
// onTurnStart and read in run, so other bots' history can be labeled without
// another query. Direct chats leave `group` false and their messages alone.
const groupTurn = chat.local<{
  botId: string
  group: boolean
  members: { id: string; name: string }[]
}>({ id: "groupTurn" })

const MODEL = "minimax/minimax-m3.1-flash"
// MODEL's context window, in tokens.
const CONTEXT_WINDOW = 1_000_000

// The bot's side of a chat, run durably on Trigger.dev. components/chat-view.tsx
// talks to it through useTriggerChatTransport; the conversation is kept in the
// platform's transcript storage under the chat id (a row in `chats`). In a
// group chat the composer sends the bot to answer as message metadata
// (`clientData.botId`), and each turn answers as that bot.
export const botChat = chat
  .withUIMessage<BotChatMessage>()
  .withClientData({ schema: z.object({ botId: z.string().optional() }) })
  .agent({
    id: "bot-chat",
    // Declared here too so screenshots reach the model as images on later turns.
    tools: sandboxTools,
    // Runs on every fresh worker (the first run and continuations): stores the
    // bot's sandbox id, read by the tools.
    onBoot: async ({ chatId, clientData }) => {
      activeChat.init({ id: chatId })
      groupTurn.init({ botId: "", group: false, members: [] })
      try {
        const { bot } = await chatBot(chatId, clientData?.botId)
        botSandbox.init({ id: bot.sandboxId })
      } catch (error) {
        // A missing member fails the turn (onTurnStart), where the client can
        // show it. Failing here would kill the run before that message exists.
        botSandbox.init({ id: null })
        if (isUserFacingChatError(error)) return
        throw error
      }
    },
    // Runs before every turn, so edits from the side panel's Configure dialog
    // apply from the next message, even in a run that's already going, and a
    // group chat answers as the bot picked for this message. Points the tools
    // at that bot's sandbox, sets its system prompt (applied by the `streamText`
    // handed to `run`), and attaches the context usage to the reply after each
    // step.
    onTurnStart: async ({ chatId, clientData }) => {
      const { bot, members, group } = await chatBot(chatId, clientData?.botId)
      botSandbox.id = bot.sandboxId
      const inGroup = group && members.length > 1
      groupTurn.botId = bot.id
      groupTurn.group = inGroup
      groupTurn.members = members.map((member) => ({
        id: member.id,
        name: member.name,
      }))
      const prompt = botInstructions(bot, inGroup ? members : undefined)
      chat.prompt.set(prompt)
      const fixed = {
        window: CONTEXT_WINDOW,
        system: estimateTokens(prompt),
        tools: await toolTokens(),
      }
      const speaker = inGroup
        ? { botId: bot.id, botName: bot.name, botAvatar: bot.avatar }
        : undefined
      chat.setUIMessageStreamOptions({
        messageMetadata: ({ part }) => {
          if (part.type === "start") return speaker
          if (part.type !== "finish-step") return undefined
          const { inputTokens = 0, outputTokens = 0 } = part.usage
          const context: ContextUsage = {
            ...fixed,
            used: inputTokens + outputTokens,
          }
          return speaker ? { ...speaker, context } : { context }
        },
      })
    },
    run: async ({ messages, tools, signal, streamText }) =>
      streamText({
        model: MODEL,
        messages:
          groupTurn.group && groupTurn.botId
            ? attributeOtherBots(
                messages,
                chat.history.all(),
                groupTurn.botId,
                groupTurn.members
              )
            : messages,
        tools,
        abortSignal: signal,
        // The SDK doesn't know this model's limits and would cap replies at 4,096
        // tokens (thinking included) without this.
        maxOutputTokens: 32_000,
        // chat.agent wraps this in the SDK's retainStepMessages, which drops
        // every tool result after the first on AI SDK 7.
        // patches/@trigger.dev__sdk@4.7.5.patch fixes it; when upgrading the
        // SDK, keep the patch until upstream fixes that function.
        prepareStep: async ({ messages, steps }) => {
          const prepared = await prepareAgentStep({
            messages,
            steps,
            loadScreenshot: loadScreenshots(signal),
          })
          // The model is looking without acting. Take the screen tools away
          // for this step; the note asking it to report what it sees is already
          // on the messages.
          if (!prepared.hideScreenTools) return { messages: prepared.messages }
          return {
            messages: prepared.messages,
            activeTools: toolsExceptScreen,
          }
        },
        // Room for a multi-step task (look, click, type, look again) in one turn.
        stopWhen: isStepCount(40),
        // Releases text word by word instead of in uneven provider chunks.
        experimental_transform: smoothStream(),
      }),
  })

// Thrown for a missing member the person can act on. Other failures stay
// ordinary Errors so the chat UI can tell them apart.
class ChatBotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ChatBotError"
  }
}

function isUserFacingChatError(error: unknown) {
  return (
    error instanceof ChatBotError &&
    (error.message === botNotInGroupMessage ||
      error.message === emptyGroupMessage)
  )
}

// The bot that answers in a chat. With no `botId`, that's the oldest member
// (a direct chat's only bot). A `botId` that isn't a member is an error: the
// browser asked for that bot, and a different one must not answer instead.
async function chatBot(chatId: string, botId?: string) {
  const found = await db.query.chats.findFirst({
    where: { id: chatId },
    with: { bots: { orderBy: { createdAt: "asc" } } },
  })
  const members = found?.bots ?? []
  const group = found?.kind === "group"
  if (botId) {
    const bot = members.find((member) => member.id === botId)
    if (!bot) throw new ChatBotError(botNotInGroupMessage)
    return { bot, members, group }
  }
  const bot = members[0]
  if (!bot) {
    if (group) throw new ChatBotError(emptyGroupMessage)
    throw new Error(`No bot in chat ${chatId}`)
  }
  return { bot, members, group }
}

// A rough token count, at about 4 characters a token. Only used to split the
// context usage the model reports into system prompt, tools and messages.
function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

// The estimated tokens the tool definitions take up in every request.
async function toolTokens() {
  const definitions = await Promise.all(
    Object.entries(sandboxTools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: await asSchema<unknown>(tool.inputSchema).jsonSchema,
    }))
  )
  return estimateTokens(JSON.stringify(definitions))
}

// A bot's base system prompt: who it is, its job and purpose, and the sandbox
// it lives in. Sections without data (no instructions, no sandbox) are left out.
// Pass `members` only for a group of two or more; a direct chat omits it, so
// its prompt stays the sections below.
function botInstructions(bot: Bot, members?: Bot[]) {
  return [
    `# Who you are
You are ${bot.name}, a bot in Meepo. Meepo is an app where a person creates their own bots, each with its own job, and talks with them. The person in this conversation created you.`,
    `# Your job
${bot.job}

Your purpose is to help the person who created you with this job. Stay in character as ${bot.name} and keep to your job.`,
    bot.instructions &&
      `# How to go about it
Your creator gave you these instructions:

${bot.instructions}`,
    bot.sandboxId &&
      `# Your environment
You have your own sandbox: an isolated Linux computer with a desktop, hosted on Daytona, that belongs to you alone. It was set up when you were created, it stays with you across conversations, and it is removed if you are deleted.

Your tools let you work in it: run shell commands, read, write and list files, and use the desktop's mouse and keyboard. Do web tasks in Chromium on that desktop. Look at the screen before you click or type, after you do, and after you launch an app from the shell. Never claim you did something in the sandbox without using a tool to do it.

When the person asks for a screenshot of the desktop or of a web page, send it with showScreen. viewScreen is only for you to look; it is not shown in the chat. Do what the person asked first. Don't close tabs, relaunch apps, or tidy the desktop unless they ask.

Launch Chromium from the shell once. If it is already running, open a page with \`chromium <url>\` instead of quitting and starting it again.`,
    members && members.length > 1 && groupInstructions(bot, members),
  ]
    .filter(Boolean)
    .join("\n\n")
}

// Tells a bot it is in a group, who else is there, and that labeled messages
// are the other bots' — including screenshots, which are not on its computer.
function groupInstructions(bot: Bot, members: Bot[]) {
  const others = members.filter((member) => member.id !== bot.id)
  const otherNames = others.map((member) => member.name).join(", ")
  const everyone = members
    .map((member) =>
      member.id === bot.id ? `${member.name} (you)` : member.name
    )
    .join(", ")
  const example = others[0]?.name ?? "their name"
  return `# This group
You are in a group chat with other bots: ${otherNames}. The bots here are ${everyone}.

You answer only as ${bot.name}. Replies from the other bots are labeled with their name in square brackets, like [${example}]. Those replies, their tool results, and their screenshots belong to them and come from their own sandboxes, not yours. Do not claim their words or actions as your own. Do not try to open their screenshots or files; they are not on your computer. If you need to see a desktop, use your own tools and look at yours.`
}
