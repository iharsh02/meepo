import type { BotChatMessage } from "@/trigger/sandbox-tools"

// The finished handOff in a group chat reply, if it has one: the bot it named
// and why. The agent uses it to tell a handed-over turn (trigger/chat.ts), and
// the chat to send the handoff on (components/chat-view.tsx).
export function handOffIn(message: BotChatMessage | undefined) {
  if (message?.role !== "assistant") return undefined
  for (const part of message.parts) {
    if (part.type === "tool-handOff" && part.state === "output-available") {
      return part.output
    }
  }
  return undefined
}

// `messages` with each handed-over answer cut down to its own parts:
// `handOffs` maps a handing-off reply's id to how many of its parts were
// copied to the front of the reply after it.
export function ownParts(
  messages: BotChatMessage[],
  handOffs: Record<string, number>
) {
  return messages.map((message, index) => {
    const copied = handOffs[messages[index - 1]?.id ?? ""]
    return copied && message.role === "assistant"
      ? { ...message, parts: message.parts.slice(copied) }
      : message
  })
}
