import { chat, type InferChatUIMessageFromTools } from "@trigger.dev/sdk/ai"
import { tool, type ModelMessage } from "ai"
import { z } from "zod"

import { getRunningSandbox, screenSize, startDesktop } from "@/lib/daytona"

// The chat's bot's sandbox id, set in the agent's onBoot (trigger/chat.ts) and
// read by every tool below. Null for a bot made before sandboxes existed.
export const botSandbox = chat.local<{ id: string | null }>({
  id: "botSandbox",
})

async function sandbox() {
  if (!botSandbox.id) throw new Error("This bot has no sandbox.")
  return getRunningSandbox(botSandbox.id)
}

// The sandbox's desktop controls, with the desktop started.
async function desktop() {
  const box = await sandbox()
  await startDesktop(box)
  return box.computerUse
}

// Long outputs are cut so one command can't flood the model's context.
function clip(text: string, max: number) {
  return text.length > max
    ? `${text.slice(0, max)}\n… [cut: ${text.length - max} more characters]`
    : text
}

const point = {
  x: z
    .number()
    .int()
    .min(0)
    .describe("Pixels from the left edge of the screen."),
  y: z
    .number()
    .int()
    .min(0)
    .describe("Pixels from the top edge of the screen."),
}

const modifiers = z
  .array(z.enum(["ctrl", "alt", "shift", "cmd"]))
  .optional()
  .describe("Modifier keys held during the action.")

// A screenshot of the sandbox's desktop, with the screen size the model needs
// for mouse coordinates.
async function screenshot() {
  const box = await sandbox()
  await startDesktop(box)
  const [shot, screen] = await Promise.all([
    box.computerUse.screenshot.takeCompressed({
      format: "jpeg",
      quality: 70,
      showCursor: true,
    }),
    screenSize(box),
  ])
  if (!shot.screenshot) throw new Error("The screenshot came back empty.")
  return { mediaType: "image/jpeg", base64: shot.screenshot, ...screen }
}

// viewScreen and showScreen are the same tool with different descriptions;
// they differ only in whether the chat UI shows the image
// (components/tool-call.tsx). The model sees the screenshot as an image, not
// base64 text, on this turn and later ones (the tools are also declared on the
// agent for that).
function screenTool(description: string) {
  return tool({
    description,
    inputSchema: z.object({}),
    execute: screenshot,
    toModelOutput: ({ output }) => ({
      type: "content",
      value: [
        {
          type: "text",
          text: `Screen is ${output.width}×${output.height} pixels; use these pixel coordinates for mouse actions.`,
        },
        {
          type: "file",
          mediaType: output.mediaType,
          data: { type: "data", data: output.base64 },
        },
      ],
    }),
  })
}

const screenshotRemoved = {
  type: "text" as const,
  text: "[Older screenshot removed to save space. Take a new one to see the screen.]",
}

// For the agent's prepareStep: keeps only the newest `keep` screenshots as
// images in what the model reads, and swaps older ones for a short note, so a
// long session doesn't fill the context with stale screens. The saved chat
// history is untouched.
export function dropOldScreenshots(messages: ModelMessage[], keep = 2) {
  let seen = 0
  return [...messages]
    .reverse()
    .map((message): ModelMessage => {
      if (message.role !== "tool") return message
      return {
        ...message,
        content: message.content.map((part) => {
          if (part.type !== "tool-result" || part.output.type !== "content") {
            return part
          }
          if (!part.output.value.some((item) => item.type === "file")) {
            return part
          }
          seen += 1
          if (seen <= keep) return part
          return {
            ...part,
            output: {
              ...part.output,
              value: part.output.value.map((item) =>
                item.type === "file" ? screenshotRemoved : item
              ),
            },
          }
        }),
      }
    })
    .reverse()
}

// The bot's tools for working in its Daytona sandbox: a shell, files, and the
// desktop's mouse, keyboard and screen. Passed to chat.agent in trigger/chat.ts.
export const sandboxTools = {
  bash: tool({
    description:
      "Run a shell command in your sandbox and get its exit code and output. Commands run non-interactively; start long-running processes in the background with output redirected to a file.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to run."),
      cwd: z
        .string()
        .optional()
        .describe("Working directory. Defaults to your home directory."),
    }),
    execute: async ({ command, cwd }) => {
      const box = await sandbox()
      const { exitCode, result } = await box.process.executeCommand(
        command,
        cwd,
        undefined,
        120
      )
      return { exitCode, output: clip(result, 20_000) }
    },
  }),

  readFile: tool({
    description: "Read a text file in your sandbox.",
    inputSchema: z.object({
      path: z.string().describe("Path of the file to read."),
    }),
    execute: async ({ path }) => {
      const box = await sandbox()
      const content = await box.fs.downloadFile(path)
      return { path, content: clip(content.toString("utf8"), 50_000) }
    },
  }),

  writeFile: tool({
    description: "Create or overwrite a text file in your sandbox.",
    inputSchema: z.object({
      path: z.string().describe("Path of the file to write."),
      content: z.string().describe("The file's full new contents."),
    }),
    execute: async ({ path, content }) => {
      const box = await sandbox()
      const data = Buffer.from(content, "utf8")
      await box.fs.uploadFile(data, path)
      return { path, bytes: data.length }
    },
  }),

  listFiles: tool({
    description: "List the files and folders in a folder of your sandbox.",
    inputSchema: z.object({
      path: z
        .string()
        .default(".")
        .describe("Folder to list. Defaults to your home directory."),
    }),
    execute: async ({ path }) => {
      const box = await sandbox()
      const files = await box.fs.listFiles(path)
      return {
        path,
        entries: files.map((file) => ({
          name: file.name,
          type: file.isDir ? "folder" : "file",
          size: file.size,
        })),
      }
    },
  }),

  mouseClick: tool({
    description:
      "Click the mouse at a point on the screen. Look at the screen first to find the point.",
    inputSchema: z.object({
      ...point,
      button: z.enum(["left", "right", "middle"]).default("left"),
      double: z
        .boolean()
        .default(false)
        .describe("Double-click instead of a single click."),
    }),
    execute: async ({ x, y, button, double }) => {
      const computer = await desktop()
      await computer.mouse.click(x, y, button, double)
      return { x, y, button, double }
    },
  }),

  mouseMove: tool({
    description:
      "Move the mouse pointer to a point on the screen, for example to hover over something.",
    inputSchema: z.object(point),
    execute: async ({ x, y }) => {
      const computer = await desktop()
      await computer.mouse.move(x, y)
      return { x, y }
    },
  }),

  mouseScroll: tool({
    description:
      "Scroll the mouse wheel with the pointer at a point on the screen.",
    inputSchema: z.object({
      ...point,
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(3)
        .describe("How many wheel steps to scroll."),
      modifiers,
    }),
    execute: async ({ x, y, direction, amount, modifiers }) => {
      const computer = await desktop()
      await computer.mouse.scroll(x, y, direction, amount, modifiers)
      return { x, y, direction, amount }
    },
  }),

  keyboardType: tool({
    description:
      "Type text with the keyboard into whatever has focus on the screen.",
    inputSchema: z.object({ text: z.string().describe("The text to type.") }),
    execute: async ({ text }) => {
      const computer = await desktop()
      await computer.keyboard.type(text)
      return { typed: text.length }
    },
  }),

  keyboardPress: tool({
    description:
      'Press one key, optionally with modifiers held, e.g. "enter", "tab", "escape", "backspace", "up", or "c" with ctrl to copy.',
    inputSchema: z.object({
      key: z.string().describe('The key to press, e.g. "enter" or "a".'),
      modifiers,
    }),
    execute: async ({ key, modifiers }) => {
      const computer = await desktop()
      await computer.keyboard.press(key, modifiers)
      return { pressed: [...(modifiers ?? []), key].join("+") }
    },
  }),

  viewScreen: screenTool(
    "Take a screenshot of your desktop to see what's on it, before and after you use the mouse or keyboard. Only you see it; it isn't shown in the chat."
  ),

  showScreen: screenTool(
    "Take a screenshot of your desktop and show it in the chat. Use it only when the person asks to see your screen or what's on it."
  ),
}

// The chat's message type, with a typed part for each tool. Shared by the
// agent (trigger/chat.ts) and the chat UI.
export type BotChatMessage = InferChatUIMessageFromTools<typeof sandboxTools>
