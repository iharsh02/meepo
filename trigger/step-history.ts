import type { ModelMessage } from "ai"

// One finished model step. Only the fields the history repair reads.
export type StepHistory = {
  response: { messages: readonly ModelMessage[] }
}

// Trigger.dev wraps the chat agent's prepareStep in `retainStepMessages`
// (SDK 4.7.5, steeringContext.js). That helper was written for AI SDK 5/6,
// where each step's `response.messages` grows to include every earlier step
// and the next prompt is rebuilt from the original messages. It remembers the
// messages prepareStep returns and appends only
// `steps.at(-1).response.messages.slice(previousLength)`.
//
// AI SDK 7 does neither. `response.messages` is only the step that just
// finished, and a tool step is always an assistant message plus a tool
// message, so the slice is empty. Every result after the first is dropped,
// and the model repeats the next call as if it had never seen one. The
// `steps` array still holds each result, so copy back any step whose tool
// call is missing. Leave the list alone when the first step is missing too:
// that is a replaced history (compaction), not this drop.
export function restoreDroppedStepMessages(
  messages: readonly ModelMessage[],
  steps: readonly StepHistory[]
): ModelMessage[] {
  if (steps.length === 0) return [...messages]
  const seenText = new Map<string, number>()
  if (!stepIsPresent(messages, steps[0]?.response.messages ?? [], seenText)) {
    return [...messages]
  }
  let gap = 1
  for (; gap < steps.length; gap++) {
    const responses = steps[gap]?.response.messages ?? []
    if (!stepIsPresent(messages, responses, seenText)) break
  }
  if (gap === steps.length) return [...messages]

  const missingSteps = steps.slice(gap)
  const { body, tail } = splitTrailingNotes(messages)
  const firstMissing = missingSteps[0]?.response.messages ?? []
  const restored = stripMatchingSuffix(body, firstMissing)
  const missing = missingSteps.flatMap((step) => step.response.messages)
  return [...restored, ...missing, ...tail]
}

function stepIsPresent(
  messages: readonly ModelMessage[],
  responses: readonly ModelMessage[],
  seenText: Map<string, number>
) {
  if (responses.length === 0) return true
  const ids = assistantToolCallIds(responses)
  if (ids.size > 0) {
    const seen = assistantToolCallIds(messages)
    for (const id of ids) if (!seen.has(id)) return false
    return true
  }
  const text = responses.map(assistantText).join("\n")
  const used = seenText.get(text) ?? 0
  if (used >= countAssistantText(messages, text)) return false
  seenText.set(text, used + 1)
  return true
}

function assistantToolCallIds(messages: readonly ModelMessage[]) {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue
    }
    for (const part of message.content) {
      if (part.type === "tool-call") ids.add(part.toolCallId)
    }
  }
  return ids
}

function assistantText(message: ModelMessage) {
  if (message.role !== "assistant") return ""
  if (typeof message.content === "string") return message.content
  return message.content
    .map((part) =>
      part.type === "text" || part.type === "reasoning" ? part.text : ""
    )
    .join("")
}

function countAssistantText(messages: readonly ModelMessage[], text: string) {
  return messages.filter(
    (message) =>
      message.role === "assistant" &&
      assistantToolCallIds([message]).size === 0 &&
      assistantText(message) === text
  ).length
}

// Notes injected on an earlier step (and steering messages) are user messages
// after the model's own turns. Keep them after the results we put back.
function splitTrailingNotes(messages: readonly ModelMessage[]) {
  let end = messages.length
  while (end > 0 && messages[end - 1]?.role === "user") end -= 1
  const body = messages.slice(0, end)
  const hasTurn = body.some(
    (message) => message.role === "assistant" || message.role === "tool"
  )
  if (!hasTurn) return { body: messages, tail: [] as ModelMessage[] }
  return { body, tail: messages.slice(end) }
}

// A shorter previous step makes the broken slice append the tail of the new
// step (the tool message) without its assistant message. Those objects are
// the step's own response messages, so drop that tail and append the step whole.
function stripMatchingSuffix(
  body: readonly ModelMessage[],
  responses: readonly ModelMessage[]
) {
  const max = Math.min(body.length, responses.length - 1)
  for (let length = max; length > 0; length--) {
    const tail = body.slice(-length)
    const suffix = responses.slice(-length)
    if (tail.every((message, index) => message === suffix[index])) {
      return body.slice(0, -length)
    }
  }
  return body
}
