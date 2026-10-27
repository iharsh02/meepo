// Shown in the group composer and as the chat's stream error. trigger/chat.ts
// throws these; components/chat-view.tsx displays them and hides anything else.
export const botNotInGroupMessage = "That bot is no longer in this group."
export const emptyGroupMessage = "This group has no bots left."

const shown = new Set([botNotInGroupMessage, emptyGroupMessage])

// The text under a failed reply. Known messages pass through; other failures
// stay generic so a stack or a chat id never reaches the screen.
export function shownChatError(error: Error) {
  return shown.has(error.message)
    ? error.message
    : "Something went wrong. Try sending that again."
}
