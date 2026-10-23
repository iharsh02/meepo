import { chat } from "@trigger.dev/sdk/ai"
import { asSchema, isStepCount, smoothStream } from "ai"

import { db } from "@/db"
import type { Bot } from "@/db/schema"
import {
  botSandbox,
  loadScreenshot,
  sandboxTools,
  type BotChatMessage,
  type ContextUsage,
} from "@/trigger/sandbox-tools"
import { prepareScreenshotMessages } from "@/trigger/screenshot-messages"

const MODEL = "minimax/minimax-m3.1-flash"
// MODEL's context window, in tokens.
const CONTEXT_WINDOW = 1_000_000

// The bot's side of a chat, run durably on Trigger.dev. components/chat-view.tsx
// talks to it through useTriggerChatTransport; the conversation is kept in the
// platform's transcript storage under the chat id (a row in `chats`).
export const botChat = chat.withUIMessage<BotChatMessage>().agent({
  id: "bot-chat",
  // Declared here too so screenshots reach the model as images on later turns.
  tools: sandboxTools,
  // Runs on every fresh worker (the first run and continuations): stores the
  // bot's sandbox id, read by the tools.
  onBoot: async ({ chatId }) => {
    const bot = await chatBot(chatId)
    botSandbox.init({ id: bot.sandboxId })
  },
  // Runs before every turn, so edits from the side panel's Configure dialog
  // apply from the next message, even in a run that's already going. Sets the
  // bot's system prompt (applied by the `streamText` handed to `run`), and
  // attaches the context usage to the reply after each step.
  onTurnStart: async ({ chatId }) => {
    const prompt = botInstructions(await chatBot(chatId))
    chat.prompt.set(prompt)
    const fixed = {
      window: CONTEXT_WINDOW,
      system: estimateTokens(prompt),
      tools: await toolTokens(),
    }
    chat.setUIMessageStreamOptions({
      messageMetadata: ({ part }) => {
        if (part.type !== "finish-step") return undefined
        const { inputTokens = 0, outputTokens = 0 } = part.usage
        const context: ContextUsage = {
          ...fixed,
          used: inputTokens + outputTokens,
        }
        return { context }
      },
    })
  },
  run: async ({ messages, tools, signal, streamText }) =>
    streamText({
      model: MODEL,
      messages,
      tools,
      abortSignal: signal,
      // The SDK doesn't know this model's limits and would cap replies at 4,096
      // tokens (thinking included) without this.
      maxOutputTokens: 32_000,
      prepareStep: async ({ messages }) => ({
        messages: await prepareScreenshotMessages(messages, loadScreenshot),
      }),
      // Room for a multi-step task (look, click, type, look again) in one turn.
      stopWhen: isStepCount(40),
      // Releases text word by word instead of in uneven provider chunks.
      experimental_transform: smoothStream(),
    }),
})

// The bot in a direct chat.
async function chatBot(chatId: string) {
  const found = await db.query.chats.findFirst({
    where: { id: chatId },
    with: { bots: true },
  })
  const bot = found?.bots[0]
  if (!bot) throw new Error(`No bot in chat ${chatId}`)
  return bot
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
function botInstructions(bot: Bot) {
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

Your tools let you work in it: run shell commands, read, write and list files, and use the desktop's mouse and keyboard. Look at the screen before you click or type, and again afterwards to check the result. Show the person your screen only when they ask to see it. Never claim you did something in the sandbox without using a tool to do it.`,
  ]
    .filter(Boolean)
    .join("\n\n")
}
