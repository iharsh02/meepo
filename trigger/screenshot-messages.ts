import type { ModelMessage } from "ai"
import { logger } from "@trigger.dev/sdk"
import { z } from "zod"

const screen = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  mediaType: z.literal("image/jpeg"),
})
const reference = screen.extend({ id: z.uuid() })
const legacyScreen = screen.extend({ base64: z.string() })

// How many screenshots a model turn keeps. Older ones are dropped, and the
// sandbox keeps only this many files per chat.
const SCREENSHOTS_TO_KEEP = 2

const OLDER =
  "[Older screenshot removed to save space. Take a new one to see the screen.]"
const EXPIRED =
  "[Screenshot expired. Take a new one before using the mouse or keyboard.]"
const UNAVAILABLE =
  "[Screenshot unavailable. Take a new screenshot before using the mouse or keyboard.]"

// A chat id is a nanoid. Reject anything that could escape the directory.
const CHAT_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/

// Parent of every per-chat screenshot directory. /tmp itself is never listed
// or pruned, so unrelated files there stay put.
export const screenshotRoot = "/tmp/meepo-screenshots"

// Thrown when a screenshot can't be read because the sandbox isn't running.
// Starting it would boot a blank desktop, so the model is told to take a new one.
export class ScreenshotExpiredError extends Error {
  constructor() {
    super("The sandbox is not running, so this screenshot has expired.")
    this.name = "ScreenshotExpiredError"
  }
}

function chatSegment(chatId: string) {
  if (!CHAT_SEGMENT.test(chatId)) {
    throw new Error("Invalid chat id for a screenshot path.")
  }
  return chatId
}

function screenshotId(id: string) {
  return z.uuid().parse(id)
}

// One chat's screenshots. The chat id is a single checked path segment.
export function screenshotDirectory(chatId: string) {
  return `${screenshotRoot}/${chatSegment(chatId)}`
}

// New screenshots live in the chat directory. Leave the chat id off for a
// reference saved before that, which is one file directly in /tmp.
export function screenshotPath(id: string, chatId?: string) {
  const uuid = screenshotId(id)
  if (chatId === undefined) return `/tmp/meepo-screenshot-${uuid}.jpg`
  return `${screenshotDirectory(chatId)}/${uuid}.jpg`
}

// True for `<uuid>.jpg` and nothing else, so pruning can't follow a path.
export function isScreenshotName(name: string) {
  if (!name.endsWith(".jpg") || name.includes("/") || name.includes("\\")) {
    return false
  }
  return z.uuid().safeParse(name.slice(0, -".jpg".length)).success
}

// File names to delete so only the newest screenshots remain. Directories and
// anything that isn't a screenshot file are left alone.
export function screenshotsToDelete(
  files: { name: string; modifiedAt: string; isDir?: boolean }[],
  keep = SCREENSHOTS_TO_KEEP
) {
  return files
    .filter((file) => !file.isDir && isScreenshotName(file.name))
    .sort((a, b) => {
      const byTime = timeOf(b.modifiedAt) - timeOf(a.modifiedAt)
      if (byTime !== 0) return byTime
      return b.name.localeCompare(a.name)
    })
    .slice(keep)
    .map((file) => file.name)
}

function timeOf(modifiedAt: string) {
  const time = Date.parse(modifiedAt)
  return Number.isFinite(time) ? time : 0
}

type ScreenshotBytes = {
  downloadFile: (path: string) => Promise<Uint8Array>
  downloadFileStream?: (
    path: string,
    options?: { signal?: AbortSignal }
  ) => Promise<AsyncIterable<Uint8Array | string>>
}

// Reads one file. Streaming is what accepts an abort signal; a runtime without
// it falls back to the buffered download.
export async function readScreenshotBytes(
  files: ScreenshotBytes,
  path: string,
  signal?: AbortSignal
) {
  if (signal?.aborted) throw abortError(signal)
  if (signal && files.downloadFileStream) {
    try {
      const stream = await files.downloadFileStream(path, { signal })
      const chunks: Uint8Array[] = []
      for await (const chunk of stream) {
        if (signal.aborted) throw abortError(signal)
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
      }
      return concatBytes(chunks)
    } catch (error) {
      if (isAbort(error, signal)) throw abortError(signal)
      if (!streamUnsupported(error)) throw error
    }
  }
  return files.downloadFile(path)
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function streamUnsupported(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("downloadFileStream is not supported")
  )
}

function isAbort(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (!error || typeof error !== "object") return false
  const name = "name" in error ? String(error.name) : ""
  const code = "code" in error ? String(error.code) : ""
  const message = "message" in error ? String(error.message) : ""
  return (
    name === "AbortError" ||
    name === "CanceledError" ||
    code === "ERR_CANCELED" ||
    message === "Download cancelled"
  )
}

function abortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason
  return new DOMException(
    typeof signal?.reason === "string"
      ? signal.reason
      : "The screenshot download was aborted.",
    "AbortError"
  )
}

// A running sandbox's file reader. No start method: loading must not boot one.
export type ScreenshotSource = {
  state: string
  download: (path: string, signal?: AbortSignal) => Promise<Uint8Array>
}

// Looks the sandbox up once, then reads every id. One that isn't already
// started is never started and never read; those screenshots have expired.
export function createScreenshotLoader(options: {
  lookup: () => Promise<ScreenshotSource | null>
  chatId: string
  signal?: AbortSignal
}) {
  let pending: Promise<ScreenshotSource | null> | undefined
  return async (id: string) => {
    if (options.signal?.aborted) throw abortError(options.signal)
    pending ??= options.lookup()
    const box = await pending
    if (!box || box.state !== "started") throw new ScreenshotExpiredError()
    return readScreenshot(box, id, options.chatId, options.signal)
  }
}

async function readScreenshot(
  box: ScreenshotSource,
  id: string,
  chatId: string,
  signal?: AbortSignal
) {
  // The chat directory is where new files go. Older references still point at
  // the flat /tmp file, so a miss there tries that path.
  const paths = [screenshotPath(id, chatId), screenshotPath(id)]
  let lastError: unknown
  for (const path of paths) {
    try {
      const bytes = await box.download(path, signal)
      return Buffer.from(bytes).toString("base64")
    } catch (error) {
      if (isAbort(error, signal)) throw abortError(signal)
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The screenshot file is missing.")
}

type ToolMessage = Extract<ModelMessage, { role: "tool" }>
type ToolPart = ToolMessage["content"][number]
type ToolResult = Extract<ToolPart, { type: "tool-result" }>

function describeScreenshot(part: ToolPart) {
  if (
    part.type !== "tool-result" ||
    (part.toolName !== "viewScreen" && part.toolName !== "showScreen")
  ) {
    return null
  }
  const saved = reference.safeParse(
    part.output.type === "json" ? part.output.value : undefined
  )
  const legacy = legacyScreen.safeParse(
    part.output.type === "json" ? part.output.value : undefined
  )
  const inline =
    part.output.type === "content" &&
    part.output.value.some((item) => item.type === "file")
  if (saved.success) return { kind: "reference" as const, image: saved.data }
  if (legacy.success) return { kind: "legacy" as const, image: legacy.data }
  if (inline) return { kind: "inline" as const }
  return null
}

function textOutput(part: ToolResult, value: string): ToolResult {
  return { ...part, output: { type: "text", value } }
}

// Expands only the newest screenshots for the model. The UI tool results and
// persisted transcript keep references; old inline screenshots remain readable.
// Walk parts backwards too, since several tool results can share one message.
export async function prepareScreenshotMessages(
  messages: ModelMessage[],
  load: (id: string) => Promise<string>,
  keep = SCREENSHOTS_TO_KEEP
) {
  const loads = new Map<string, Promise<string>>()
  let seen = 0
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool") continue
    for (const part of [...message.content].reverse()) {
      const shot = describeScreenshot(part)
      if (!shot) continue
      seen += 1
      if (seen > keep || shot.kind !== "reference") continue
      if (loads.has(shot.image.id)) continue
      const id = shot.image.id
      loads.set(
        id,
        Promise.resolve().then(() => load(id))
      )
    }
  }
  await Promise.allSettled(loads.values())

  seen = 0
  const result: ModelMessage[] = []
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool") {
      result.push(message)
      continue
    }
    const content: typeof message.content = []
    for (const part of [...message.content].reverse()) {
      if (part.type !== "tool-result") {
        content.unshift(part)
        continue
      }
      const shot = describeScreenshot(part)
      if (!shot) {
        content.unshift(part)
        continue
      }
      seen += 1
      if (seen > keep) {
        content.unshift(textOutput(part, OLDER))
        continue
      }
      if (shot.kind === "inline") {
        content.unshift(part)
        continue
      }
      let base64: string
      try {
        base64 =
          shot.kind === "reference"
            ? await must(loads.get(shot.image.id))
            : shot.image.base64
      } catch (error) {
        if (isAbort(error)) throw error instanceof Error ? error : abortError()
        if (!(error instanceof ScreenshotExpiredError)) {
          logger.error("Failed to load screenshot", {
            id: shot.kind === "reference" ? shot.image.id : undefined,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        content.unshift(
          textOutput(
            part,
            error instanceof ScreenshotExpiredError ? EXPIRED : UNAVAILABLE
          )
        )
        continue
      }
      const image = shot.image
      content.unshift({
        ...part,
        output: {
          type: "content",
          value: [
            {
              type: "text",
              text: `Screen is ${image.width}×${image.height} pixels; use these pixel coordinates for mouse actions.`,
            },
            {
              type: "file",
              mediaType: image.mediaType,
              data: { type: "data", data: base64 },
            },
          ],
        },
      })
    }
    result.push({ ...message, content })
  }
  return result.reverse()
}

function must<T>(value: T | undefined) {
  if (value === undefined) throw new Error("The screenshot was not loaded.")
  return value
}
