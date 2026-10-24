const SCREEN_TOOLS = new Set(["viewScreen", "showScreen"])
const POINTER_TOOLS = new Set([
  "mouseClick",
  "mouseMove",
  "mouseScroll",
  "keyboardType",
  "keyboardPress",
])

export const SCREEN_LOOK_LIMIT = 3

export const STOP_LOOKING =
  "You have looked at the screen several times without using the mouse or keyboard. Tell the person what you see and what is blocking you."

// How many screen shots sit at the end of the turn without a mouse or keyboard
// action after them. Other tools, such as the shell, do not reset the count.
export function screenLookStreak(toolNames: string[]) {
  let streak = 0
  for (let index = toolNames.length - 1; index >= 0; index--) {
    const name = toolNames[index]
    if (name === undefined) continue
    if (POINTER_TOOLS.has(name)) break
    if (SCREEN_TOOLS.has(name)) streak += 1
  }
  return streak
}
