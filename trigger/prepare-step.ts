import type { ModelMessage } from "ai"

import {
  SCREEN_LOOK_LIMIT,
  screenLookStreak,
  STOP_LOOKING,
} from "@/trigger/screen-loop"
import { prepareScreenshotMessages } from "@/trigger/screenshot-messages"
import {
  restoreDroppedStepMessages,
  type StepHistory,
} from "@/trigger/step-history"

// How many identical tool calls in a row before the model is told to stop.
// Two is enough to catch a loop on the step that would make it three.
const REPEAT_LIMIT = 2

type StepCall = { toolName: string; input: unknown }

export type AgentStep = StepHistory & {
  toolCalls: readonly StepCall[]
}

// Messages for one model step: full tool history, screenshot images, and a
// note when the model is looking or repeating itself instead of moving on.
export async function prepareAgentStep(options: {
  messages: readonly ModelMessage[]
  steps: readonly AgentStep[]
  loadScreenshot: (id: string) => Promise<string>
}) {
  const restored = restoreDroppedStepMessages(options.messages, options.steps)
  let messages = await prepareScreenshotMessages(
    restored,
    options.loadScreenshot
  )
  const repeat = repeatedCallNote(options.steps)
  if (repeat) messages = withNote(messages, repeat)
  const calls = options.steps.flatMap((step) =>
    step.toolCalls.map((call) => call.toolName)
  )
  const hideScreenTools = screenLookStreak(calls) >= SCREEN_LOOK_LIMIT
  if (hideScreenTools) messages = withNote(messages, STOP_LOOKING)
  return { messages, hideScreenTools }
}

function withNote(messages: ModelMessage[], note: string) {
  const already = messages.some(
    (message) => message.role === "user" && message.content === note
  )
  if (already) return messages
  return [...messages, { role: "user" as const, content: note }]
}

// The note for a trailing run of identical calls, or null when the model is
// still doing something new. Compared on tool name and input, so `pgrep` and
// `pgrep` count and `pgrep` then `chromium <url>` does not.
export function repeatedCallNote(steps: readonly AgentStep[]) {
  const calls = steps.flatMap((step) => step.toolCalls)
  if (calls.length < REPEAT_LIMIT) return null
  const latest = calls[calls.length - 1]
  if (!latest) return null
  const key = callKey(latest)
  let count = 0
  for (let index = calls.length - 1; index >= 0; index--) {
    const call = calls[index]
    if (!call || callKey(call) !== key) break
    count += 1
  }
  if (count < REPEAT_LIMIT) return null
  return [
    `You are repeating the same ${latest.toolName} call${callDetail(latest)}.`,
    "You already have its result above. Use that result and do the next part of what the person asked, or say what is blocking you.",
    "Do not run that call again.",
  ].join(" ")
}

function callKey(call: StepCall) {
  return `${call.toolName}\0${JSON.stringify(call.input ?? null)}`
}

function callDetail(call: StepCall) {
  const command = bashCommand(call)
  if (!command) return ""
  const shown = command.length > 180 ? `${command.slice(0, 180)}…` : command
  return ` (${shown})`
}

function bashCommand(call: StepCall) {
  if (
    call.toolName !== "bash" ||
    !call.input ||
    typeof call.input !== "object"
  ) {
    return null
  }
  if (!("command" in call.input)) return null
  const command = call.input.command
  return typeof command === "string" ? command : null
}
