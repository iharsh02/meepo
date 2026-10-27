import { chat } from "@trigger.dev/sdk/ai"
import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai"
import { z } from "zod"

import {
  getRunningSandbox,
  getStartedSandbox,
  screenSize,
  startDesktop,
} from "@/lib/daytona"
import { shownCommandOutput } from "@/trigger/command-output"
import {
  createScreenshotLoader,
  mkdirScreenshotCommand,
  newScreenshotId,
  readScreenshotBytes,
  saveScreenshot,
  SCREENSHOT_COMMAND_TIMEOUT_SECONDS,
  screenshotCache,
} from "@/trigger/screenshot-messages"

// The chat's bot's sandbox id, set in the agent's onBoot (trigger/chat.ts) and
// read by every tool below. Null for a bot made before sandboxes existed.
export const botSandbox = chat.local<{ id: string | null }>({
  id: "botSandbox",
})

// The chat these tools are running in, set alongside the sandbox id. Screenshot
// files are grouped by it so pruning one chat leaves the others alone.
export const activeChat = chat.local<{ id: string }>({ id: "activeChat" })

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

// showScreen keeps its image in the tool result so the person can see it.
// Private viewScreen images live in the sandbox and are loaded only for the
// model, in prepareScreenshotMessages.
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

// A loader for this turn's prior screenshots. The sandbox is looked up once
// and only used when it is already started, so a text reply never boots it.
export function loadScreenshots(signal?: AbortSignal) {
  const sandboxId = botSandbox.id
  if (!sandboxId) {
    return async () => {
      throw new Error("This bot has no sandbox.")
    }
  }
  const chatId = activeChat.id
  return createScreenshotLoader({
    chatId,
    signal,
    cache: screenshotCache,
    lookup: async () => {
      const box = await getStartedSandbox(sandboxId)
      if (!box || box.state !== "started") return null
      return {
        state: box.state,
        download: (path, fileSignal) =>
          readScreenshotBytes(
            {
              downloadFile: (file, timeout) =>
                box.fs.downloadFile(file, timeout),
              downloadFileStream: (file, options) =>
                box.fs.downloadFileStream(file, options),
            },
            path,
            fileSignal
          ),
      }
    },
  })
}

// viewScreen saves into the chat's directory, then drops every file but the
// newest two. A failure here throws, so the tool never returns an id whose
// file was not stored. The image is cached only after that succeeds.
async function storeScreenshot(
  box: Awaited<ReturnType<typeof sandbox>>,
  chatId: string,
  id: string,
  base64: string
) {
  await saveScreenshot({
    chatId,
    id,
    bytes: Buffer.from(base64, "base64"),
    mkdir: async (dir) => {
      const { exitCode, result } = await box.process.executeCommand(
        mkdirScreenshotCommand(chatId),
        undefined,
        undefined,
        SCREENSHOT_COMMAND_TIMEOUT_SECONDS
      )
      if (exitCode !== 0) {
        throw new Error(result || `Couldn't create ${dir}.`)
      }
    },
    upload: async (path, bytes) => {
      await box.fs.uploadFile(Buffer.from(bytes), path)
    },
    list: (dir) => box.fs.listFiles(dir),
    remove: (path) => box.fs.deleteFile(path),
    listLegacy: async () => {
      const { exitCode, result } = await box.process.executeCommand(
        "find /tmp -maxdepth 1 -type f -name 'meepo-screenshot-*.jpg'",
        undefined,
        undefined,
        SCREENSHOT_COMMAND_TIMEOUT_SECONDS
      )
      if (exitCode !== 0) {
        throw new Error(result || "Couldn't list old screenshots.")
      }
      return result
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((file) => ({ name: file.slice(file.lastIndexOf("/") + 1) }))
    },
  })
}

// The bot's tools for working in its Daytona sandbox: a shell, files, and the
// desktop's mouse, keyboard and screen. Passed to chat.agent in trigger/chat.ts.
export const sandboxTools = {
  bash: tool({
    description:
      "Run a shell command in your sandbox and get its exit code and output. The desktop display is already set (DISPLAY=:0). The shell is zsh, so a glob that matches nothing fails. Commands run non-interactively. Start a long-running app in the background with its output redirected, for example `nohup chromium --no-session-restore --new-window <url> > /tmp/chromium.log 2>&1 &`. Without that redirect the call stays open until the app exits.",
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
        { DISPLAY: ":0" },
        120
      )
      return { exitCode, output: shownCommandOutput(result) }
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

  viewScreen: tool({
    description:
      "Take a screenshot of your desktop so you can see it, before and after you click, type, or launch an app. Only you see it. To send a screenshot to the person, including a web page, use showScreen.",
    inputSchema: z.object({}),
    execute: async () => {
      const { base64, ...screen } = await screenshot()
      const id = newScreenshotId()
      const chatId = activeChat.id
      await storeScreenshot(await sandbox(), chatId, id, base64)
      screenshotCache.remember(chatId, id, base64)
      return { id, ...screen }
    },
  }),

  showScreen: screenTool(
    "Take a screenshot of your desktop and show it in the chat. Use it when the person asks to see the screen or a web page open on it."
  ),
}

// How full the model's context window is after a reply step, in tokens: all
// of it (`window`), what the last step used, and the estimated share of that
// taken by the system prompt and the tool definitions (the rest is messages).
// The agent attaches it to each reply (trigger/chat.ts) for the Context card
// in the chat's side panel (components/agent-panel.tsx).
export type ContextUsage = {
  window: number
  used: number
  system: number
  tools: number
}

// The chat's message type, with a typed part for each tool and the context
// usage as metadata. Shared by the agent (trigger/chat.ts) and the chat UI.
export type BotChatMessage = UIMessage<
  {
    context?: ContextUsage
    // Which bot wrote this reply. Set for group chats; direct chats omit it.
    botId?: string
    botName?: string
    botAvatar?: string
  },
  UIDataTypes,
  InferUITools<typeof sandboxTools>
>
