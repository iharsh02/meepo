import type { ModelMessage, ToolResultPart, UIMessage } from "ai"

// Labels other bots' replies before they reach the model. One assistant UI
// message can become several model messages (a step, its tool results, the
// next step), so a speaker lasts until the next user message. The answering
// bot's own turns are left untouched. If the two histories don't line up,
// the original messages are returned rather than labeling the wrong bot.
export function attributeOtherBots(
  messages: ModelMessage[],
  uiMessages: UIMessage[],
  currentBotId: string,
  members: { id: string; name: string }[]
) {
  const names = new Map(members.map((member) => [member.id, member.name]))
  const assistants = uiMessages.filter(
    (message) =>
      message.role === "assistant" &&
      message.parts.some((part) => part.type !== "step-start")
  )
  let assistantIndex = 0
  let inTurn = false
  let speakerId: string | undefined
  let speakerName: string | undefined
  let overrun = false

  const attributed = messages.map((message) => {
    if (message.role === "user") {
      inTurn = false
      speakerId = undefined
      speakerName = undefined
      return message
    }
    if (message.role !== "assistant" && message.role !== "tool") return message
    if (message.role === "assistant" && !inTurn) {
      const assistant = assistants[assistantIndex]
      assistantIndex += 1
      inTurn = true
      if (!assistant) {
        overrun = true
        speakerId = undefined
        speakerName = undefined
      } else {
        speakerId = metadataString(assistant, "botId")
        speakerName =
          (speakerId ? names.get(speakerId) : undefined) ??
          metadataString(assistant, "botName") ??
          "Another bot"
      }
    }
    if (overrun || !speakerId || speakerId === currentBotId || !speakerName) {
      return message
    }
    return labelMessage(message, speakerName)
  })

  return overrun ? messages : attributed
}

function metadataString(message: UIMessage, key: "botId" | "botName") {
  const metadata = message.metadata
  if (typeof metadata !== "object" || metadata === null) return undefined
  if (!(key in metadata)) return undefined
  const value = Reflect.get(metadata, key)
  return typeof value === "string" ? value : undefined
}

function labelMessage(message: ModelMessage, name: string) {
  if (message.role === "assistant") return labelAssistant(message, name)
  if (message.role === "tool") return labelTools(message, name)
  return message
}

function labelAssistant(
  message: Extract<ModelMessage, { role: "assistant" }>,
  name: string
): ModelMessage {
  const label = `[${name}]`
  if (typeof message.content === "string") {
    return { ...message, content: `${label} ${message.content}` }
  }
  let labeled = false
  const content = message.content.map((part) => {
    if (labeled || part.type !== "text") return part
    labeled = true
    return { ...part, text: `${label} ${part.text}` }
  })
  return {
    ...message,
    content: labeled ? content : [{ type: "text", text: label }, ...content],
  }
}

// Screenshots are replaced outright: they live in that bot's sandbox, and
// loading them here would look in the answering bot's sandbox and fail.
function labelTools(
  message: Extract<ModelMessage, { role: "tool" }>,
  name: string
): ModelMessage {
  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== "tool-result") return part
      if (part.toolName === "viewScreen" || part.toolName === "showScreen") {
        return {
          ...part,
          output: {
            type: "text" as const,
            value: [
              `${name} took this screenshot on their own computer.`,
              "It is not in your sandbox, so you cannot open it.",
              "Take your own screenshot if you need to see a desktop.",
            ].join(" "),
          },
        }
      }
      return { ...part, output: noteOutput(part.output, name) }
    }),
  }
}

function noteOutput(
  output: ToolResultPart["output"],
  name: string
): ToolResultPart["output"] {
  const note = `This tool result belongs to ${name}, not you.`
  switch (output.type) {
    case "text":
    case "error-text":
      return { ...output, value: `${note}\n${output.value}` }
    case "json":
    case "error-json":
      return { type: "text", value: `${note}\n${JSON.stringify(output.value)}` }
    case "content":
      return {
        ...output,
        value: [{ type: "text", text: note }, ...output.value],
      }
    case "execution-denied":
      return {
        type: "text",
        value: output.reason ? `${note}\n${output.reason}` : note,
      }
    default: {
      const unreachable: never = output
      return unreachable
    }
  }
}
