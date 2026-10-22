import { chat } from "@trigger.dev/sdk/ai"
import { isStepCount, smoothStream } from "ai"

import { db } from "@/db"
import type { Bot } from "@/db/schema"
import {
  botSandbox,
  dropOldScreenshots,
  sandboxTools,
  type BotChatMessage,
} from "@/trigger/sandbox-tools"

// The bot's side of a chat, run durably on Trigger.dev. components/chat-view.tsx
// talks to it through useTriggerChatTransport; the conversation is kept in the
// platform's transcript storage under the chat id (a row in `chats`).
export const botChat = chat.withUIMessage<BotChatMessage>().agent({
  id: "bot-chat",
  // Declared here too so screenshots reach the model as images on later turns.
  tools: sandboxTools,
  // Runs on every fresh worker (the first run and continuations): loads the
  // chat's bot, stores its system prompt (applied by the `streamText` handed to
  // `run`) and its sandbox id (read by the tools).
  onBoot: async ({ chatId }) => {
    const found = await db.query.chats.findFirst({
      where: { id: chatId },
      with: { bots: true },
    })
    const bot = found?.bots[0]
    if (!bot) throw new Error(`No bot in chat ${chatId}`)
    botSandbox.init({ id: bot.sandboxId })
    chat.prompt.set(botInstructions(bot))
  },
  run: async ({ messages, tools, signal, streamText }) =>
    streamText({
      model: "minimax/minimax-m3.1-flash",
      messages,
      tools,
      abortSignal: signal,
      // The SDK doesn't know this model's limits and would cap replies at 4,096
      // tokens (thinking included) without this.
      maxOutputTokens: 32_000,
      prepareStep: ({ messages }) => ({
        messages: dropOldScreenshots(messages),
      }),
      // Room for a multi-step task (look, click, type, look again) in one turn.
      stopWhen: isStepCount(40),
      // Releases text word by word instead of in uneven provider chunks.
      experimental_transform: smoothStream(),
    }),
})

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
