import { chat } from "@trigger.dev/sdk/ai"
import { asSchema, isStepCount, smoothStream, type StopCondition } from "ai"
import { z } from "zod"

import { db } from "@/db"
import { handOffIn } from "@/lib/hand-off"
import type { Bot } from "@/db/schema"
import {
  activeChat,
  botSandbox,
  groupTurn,
  loadScreenshots,
  sandboxTools,
  type BotChatMessage,
  type ContextUsage,
} from "@/trigger/sandbox-tools"
import { prepareAgentStep } from "@/trigger/prepare-step"

type ToolName = keyof typeof sandboxTools

const toolNames = Object.keys(sandboxTools) as ToolName[]

const MODEL = "minimax/minimax-m3.1-flash"
// MODEL's context window, in tokens.
const CONTEXT_WINDOW = 1_000_000

// The bot's side of a chat, run durably on Trigger.dev. components/chat-view.tsx
// talks to it through useTriggerChatTransport; the conversation is kept in the
// platform's transcript storage under the chat id (a row in `chats`). In a
// group chat the composer sends the bot to answer as message metadata
// (`clientData.botId`), and each turn answers as that bot. A bot can pass a
// message on with the handOff tool; the chat then sends a "handoff" action
// with the new bot's id, and that bot answers without a new user message.
export const botChat = chat
  .withUIMessage<BotChatMessage>()
  // Optional as a whole: a run's boot metadata is empty, since startSession
  // sends none and only group messages carry a botId.
  .withClientData({
    schema: z.object({ botId: z.string().optional() }).optional(),
  })
  .agent({
    id: "bot-chat",
    // Declared here too so screenshots reach the model as images on later turns.
    tools: sandboxTools,
    actionSchema: z.object({ type: z.literal("handoff") }),
    // A handoff answers the history as it stands: the bot named in the
    // action's metadata (`clientData.botId`) replies to the person's last
    // message, which the previous bot handed over.
    onAction: async () => chat.turn(),
    // Runs on every fresh worker (the first run and continuations). The
    // sandbox id is set per turn in onTurnStart, since a group's turns can go
    // to different bots.
    onBoot: async ({ chatId }) => {
      botSandbox.init({ id: null })
      activeChat.init({ id: chatId })
      groupTurn.init({ botId: null, members: [], canHandOff: false })
    },
    // Runs before every turn, so edits from the side panel's Configure dialog
    // apply from the next message, even in a run that's already going, and a
    // group chat answers as the bot picked for this message. Points the tools
    // at that bot's sandbox and group, sets its system prompt (applied by the
    // `streamText` handed to `run`), and attaches the context usage (and, in a
    // group, which bot wrote the reply) to the reply.
    onTurnStart: async ({ chatId, clientData, uiMessages }) => {
      const { bot, members, group } = await chatBot(chatId, clientData?.botId)
      const handedOff = endsInHandOff(uiMessages)
      botSandbox.id = bot.sandboxId
      groupTurn.botId = bot.id
      groupTurn.members = group
        ? members.map(({ id, name }) => ({ id, name }))
        : []
      groupTurn.canHandOff = group && members.length > 1 && !handedOff
      const prompt = botInstructions(
        bot,
        group ? { members, handedOff } : undefined
      )
      chat.prompt.set(prompt)
      const fixed = {
        window: CONTEXT_WINDOW,
        system: estimateTokens(prompt),
        tools: await toolTokens(),
      }
      const speaker = group
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
          return { ...speaker, context }
        },
      })
    },
    run: async ({ messages, tools, signal, streamText }) => {
      const activeTools = toolNames.filter(
        (name) => name !== "handOff" || groupTurn.canHandOff
      )
      return streamText({
        model: MODEL,
        messages,
        tools,
        activeTools,
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
            activeTools: activeTools.filter(
              (name) => name !== "viewScreen" && name !== "showScreen"
            ),
          }
        },
        // Room for a multi-step task (look, click, type, look again) in one
        // turn. A handoff ends the turn so the other bot can answer.
        stopWhen: [isStepCount(40), handedOffInLastStep],
        // Releases text word by word instead of in uneven provider chunks.
        experimental_transform: smoothStream(),
      })
    },
  })

// The bot that answers in a chat, the chat's members, and whether it's a
// group. With no `botId`, that's the oldest member (a direct chat's only bot).
// A `botId` that isn't a member fails the turn rather than letting a
// different bot answer.
async function chatBot(chatId: string, botId?: string) {
  const found = await db.query.chats.findFirst({
    where: { id: chatId },
    with: { bots: { orderBy: { createdAt: "asc" } } },
  })
  const members = found?.bots ?? []
  const bot = botId ? members.find((member) => member.id === botId) : members[0]
  if (!bot) throw new Error(`Bot ${botId ?? "(none)"} isn't in chat ${chatId}`)
  return { bot, members, group: found?.kind === "group" }
}

// Stops a turn once handOff has succeeded, so the named bot answers next. A
// failed call (a wrong id) doesn't stop it: the bot can retry or answer.
const handedOffInLastStep: StopCondition<typeof sandboxTools> = ({ steps }) =>
  steps.at(-1)?.toolResults.some((result) => result.toolName === "handOff") ??
  false

// Whether the conversation ends with another bot handing the person's message
// over: a last reply with a finished handOff in it. True on the turn a
// "handoff" action starts, and when that turn's answer is regenerated.
function endsInHandOff(uiMessages: BotChatMessage[]) {
  return handOffIn(uiMessages.at(-1)) !== undefined
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

// A bot's system prompt: who it is, its job and purpose, the sandbox it lives
// in, and in a group chat the group it's in. Sections without data (no
// instructions, no sandbox, a direct chat) are left out.
function botInstructions(
  bot: Bot,
  group?: { members: Bot[]; handedOff: boolean }
) {
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
    `# Choosing how to help
Identify the outcome the person wants from this message, using the conversation to resolve follow-ups. A request to explain or draft something usually needs a text reply. A request to inspect or change something needs evidence from the relevant tool. Don't run tools just because a topic sounds technical.

In a group, decide who should handle the message before starting work, using the handoff rules below. Otherwise handle it yourself. Use the smallest set of available tools that can complete the request. Never invent a tool, a tool result, or another bot's capabilities.

After a tool returns, read its output and check whether it achieved the intended result. An error or a command that merely started is not success. Use what you learned to choose the next action; don't repeat an unchanged failing call. When finished, report the result and any remaining limitation. If essential information is missing, ask one focused question.`,
    bot.sandboxId &&
      `# Your environment
You have your own sandbox: an isolated Linux computer with a desktop, hosted on Daytona, that belongs to you alone. It was set up when you were created, it stays with you across conversations, and it is removed if you are deleted.

Your tools let you work in it: run shell commands, read, write and list files, and use the desktop's mouse and keyboard. Do web tasks in Chromium on that desktop. Look at the screen before you click or type, after you do, and after you launch an app from the shell. Never claim you did something in the sandbox without using a tool to do it.

When the person asks for a screenshot of the desktop or of a web page, send it with showScreen. viewScreen is only for you to look; it is not shown in the chat. Do what the person asked first. Don't close tabs, relaunch apps, or tidy the desktop unless they ask.

Launch Chromium from the shell once. If it is already running, open a page with \`chromium <url>\` instead of quitting and starting it again.`,
    bot.sandboxId
      ? `# Choosing a sandbox tool
- Find an unknown file path with listFiles; read a known text file with readFile. Use bash for searches across files, commands, builds, tests, or running scripts.
- Use writeFile only when the request calls for creating or changing a file. It replaces the whole file: read an existing file before editing it and preserve unrelated content. Drafting text in chat does not require writing a file.
- For websites and desktop apps, use Chromium and the desktop tools. Use viewScreen to locate controls, mouseClick to focus or activate them, keyboardType to enter text, keyboardPress for keys or shortcuts, and mouseScroll or mouseMove when scrolling or hovering is needed. Base coordinates on a recent screenshot; inspect the result after an interaction before choosing the next one.
- viewScreen is private observation. showScreen shares the screen with the person. If they asked to see the screen, showScreen supplies the screenshot; a private viewScreen call does not fulfill that request.
- Text-only explanations and drafts need no sandbox tools. A question about the current screen, a file, or a command's result does need inspection. Stop inspecting once you have enough evidence to answer or act.`
      : `# Available environment
You have no sandbox attached. Do not call shell, file, screenshot, mouse, or keyboard tools. You can answer from the conversation, explain steps, or ask for the information you need.`,
    group && groupInstructions(bot, group.members, group.handedOff),
  ]
    .filter(Boolean)
    .join("\n\n")
}

// The group chat section of a bot's prompt: who else is in the group and what
// they do, whose earlier replies are whose, what its tools can reach, and when
// to hand a message to another bot. A bot that was handed the message is told
// to answer it.
function groupInstructions(bot: Bot, members: Bot[], handedOff: boolean) {
  const roster = members
    .map(
      (member) =>
        `- ${member.name}${member.id === bot.id ? " (you)" : ""}: ${member.job} (id: ${member.id})`
    )
    .join("\n")
  const others = members.filter((member) => member.id !== bot.id)
  return [
    `# This group chat
This conversation is a group chat. The person who created you added several of their bots to it:

${roster}

You are the selected bot for this message, either through a mention or the conversation's current selection. Answer only as ${bot.name}. Earlier replies in this conversation may have been written by other bots. You didn't write them, so don't take credit for their words or their work, and don't repeat what they already did unless asked. You can build on what they found.`,
    `# Your tools in this group
Your tools only reach your own sandbox. The other bots each have their own, and you can't see or use their files, shell or desktop. Their tool calls ran on their computers, not yours, and their screenshots can't be opened from yours. If you need to check something, use your own tools on your own computer.`,
    handedOff
      ? `# You were handed this message
Another bot in this group handed the person's last message to you, because your job fits it better. Its last reply ends with that handOff call and its reason. Answer the person's message yourself now. You can't hand it on.`
      : others.length > 0 &&
        `# Handing off
Choose whether to hand off before answering or taking actions:
1. An @mention of you only routes the message to you first. In this app the person mentions a bot to send any message, so it is not a request for you to do the work. Keep the task only if they explicitly say you should do it (for example "you do it" or "don't pass this on"). If they ask you to pass it to another member, hand it off.
2. Compare the requested outcome with your job and the other jobs in the roster. Match the work to be done, not isolated keywords or bot names. Use only the listed jobs as evidence of another bot's expertise; do not assume it has extra tools, accounts, or access to your sandbox.
3. Hand off only when one other member has a clear advantage for the main request. Keep tasks you can handle well, small talk, and follow-ups about your own work. If jobs overlap or no member is a clearly better fit, keep the task. For a genuinely ambiguous request where the missing detail changes who should handle it, ask one focused question.
4. For a request spanning several jobs, choose based on its main deliverable. handOff transfers the whole message; it does not split work or run bots in parallel. Do not hand off a task that requires files or logged-in state only available in your sandbox. A tool error or a difficult step alone is not a reason to transfer it.
5. If handing off, call handOff once, using the exact member id from the roster and a short reason connecting that member's job to the requested outcome. Make this the only tool call in that step. Do not perform part of the task first or give a full answer before handing off. At most announce the transfer in one short sentence. The recipient will answer the existing conversation next.

Examples, only when the roster actually contains these jobs:
- A coding bot receiving a request for launch-announcement copy can hand it to a marketing bot; the deliverable is marketing copy.
- A coding bot asked to fix a marketing website's broken form keeps it; the deliverable is a code fix.
- A request to revise your previous answer stays with you.
- "@you review this Python function for bugs", when you are a writing editor and the roster has a code reviewer, goes to the code reviewer: the mention only routed it to you.`,
  ]
    .filter(Boolean)
    .join("\n\n")
}
