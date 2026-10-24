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
// Recent images kept on this worker so the next model step doesn't download
// them again. Not chat.local: that store is copied into run metadata, which
// is capped at 256KB, and one desktop jpeg can be larger than that.
const CACHED_SCREENSHOTS = 4
const CACHED_CHATS = 32
// Daytona's download helpers otherwise wait 30 minutes.
export const SCREENSHOT_DOWNLOAD_TIMEOUT_SECONDS = 15

const OLDER =
  "[Older screenshot removed to save space. Take a new one to see the screen.]"
const EXPIRED =
  "[Screenshot expired. Take a new one before using the mouse or keyboard.]"

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
      // Same timestamp: a UUIDv7 name is newer when it sorts later.
      if (a.name < b.name) return 1
      if (a.name > b.name) return -1
      return 0
    })
    .slice(keep)
    .map((file) => file.name)
}

function timeOf(modifiedAt: string) {
  const time = Date.parse(modifiedAt)
  return Number.isFinite(time) ? time : 0
}

// UUIDv7, so when two files share a modification time the later id sorts
// later and pruning keeps it. randomUUID() is v4 and would sort at random.
export function newScreenshotId(now = Date.now()) {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const timestamp = Math.floor(now)
  const at = (shift: number) => Math.floor(timestamp / 2 ** shift) & 0xff
  bytes[0] = at(40)
  bytes[1] = at(32)
  bytes[2] = at(24)
  bytes[3] = at(16)
  bytes[4] = at(8)
  bytes[5] = at(0)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const LEGACY_FILE =
  /^meepo-screenshot-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/i

export function legacyScreenshotId(name: string) {
  const match = LEGACY_FILE.exec(name)
  if (!match?.[1]) return null
  const parsed = z.uuid().safeParse(match[1])
  return parsed.success ? parsed.data : null
}

export function legacyScreenshotsToDelete(names: string[]) {
  return names.filter((name) => legacyScreenshotId(name) !== null)
}

export function mkdirScreenshotCommand(chatId: string) {
  return `mkdir -p -- ${screenshotDirectory(chatId)}`
}

// In-memory images for this process. A fresh worker starts empty and reads
// the sandbox; a later step in the same run does not.
export type ScreenshotCache = {
  remember: (chatId: string, id: string, base64: string) => void
  recall: (chatId: string, id: string) => string | undefined
}

export function createScreenshotCache(): ScreenshotCache {
  const chats = new Map<string, Map<string, string>>()
  return {
    remember(chatId, id, base64) {
      let shots = chats.get(chatId)
      if (shots) chats.delete(chatId)
      else shots = new Map()
      chats.set(chatId, shots)
      shots.delete(id)
      shots.set(id, base64)
      while (shots.size > CACHED_SCREENSHOTS) {
        const oldest = shots.keys().next().value
        if (oldest === undefined) break
        shots.delete(oldest)
      }
      while (chats.size > CACHED_CHATS) {
        const oldestChat = chats.keys().next().value
        if (oldestChat === undefined) break
        chats.delete(oldestChat)
      }
    },
    recall(chatId, id) {
      return chats.get(chatId)?.get(id)
    },
  }
}

export const screenshotCache = createScreenshotCache()

function unavailable(error: unknown) {
  const reason = (error instanceof Error ? error.message : "unknown error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
  return `[Screenshot unavailable: ${reason || "unknown error"}. Continue without this image.]`
}

type ScreenshotBytes = {
  downloadFile: (path: string, timeoutSeconds?: number) => Promise<Uint8Array>
  downloadFileStream?: (
    path: string,
    options?: { signal?: AbortSignal; timeout?: number }
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
      const stream = await files.downloadFileStream(path, {
        signal,
        timeout: SCREENSHOT_DOWNLOAD_TIMEOUT_SECONDS,
      })
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
  return files.downloadFile(path, SCREENSHOT_DOWNLOAD_TIMEOUT_SECONDS)
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
  cache?: ScreenshotCache
}) {
  let pending: Promise<ScreenshotSource | null> | undefined
  return async (id: string) => {
    if (options.signal?.aborted) throw abortError(options.signal)
    const cached = options.cache?.recall(options.chatId, id)
    if (cached) return cached
    pending ??= options.lookup()
    const box = await pending
    if (!box || box.state !== "started") throw new ScreenshotExpiredError()
    const base64 = await readScreenshot(box, id, options.chatId, options.signal)
    options.cache?.remember(options.chatId, id, base64)
    return base64
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
  // The chat-directory miss is the error worth reporting. The legacy path is
  // only a fallback, and its failure would hide why the real file didn't load.
  let primary: unknown
  for (const path of paths) {
    try {
      const bytes = await box.download(path, signal)
      return Buffer.from(bytes).toString("base64")
    } catch (error) {
      if (isAbort(error, signal)) throw abortError(signal)
      primary ??= error
    }
  }
  throw primary instanceof Error
    ? primary
    : new Error("The screenshot file is missing.")
}

type ScreenshotFile = { name: string; modifiedAt: string; isDir?: boolean }

// Writes one screenshot and then drops older files. mkdir and upload errors
// propagate: the caller must not return an id for a file that was not stored.
export async function saveScreenshot(options: {
  chatId: string
  id: string
  bytes: Uint8Array
  mkdir: (dir: string) => Promise<void>
  upload: (path: string, bytes: Uint8Array) => Promise<void>
  list: (dir: string) => Promise<ScreenshotFile[]>
  remove: (path: string) => Promise<void>
  listLegacy?: () => Promise<{ name: string }[]>
}) {
  const dir = screenshotDirectory(options.chatId)
  await options.mkdir(dir)
  await options.upload(
    screenshotPath(options.id, options.chatId),
    options.bytes
  )
  const files = await options.list(dir)
  const stale = screenshotsToDelete(files)
  await Promise.all(
    stale.map((name) =>
      options.remove(
        screenshotPath(name.slice(0, -".jpg".length), options.chatId)
      )
    )
  )
  const kept =
    files.filter((file) => !file.isDir && isScreenshotName(file.name)).length -
    stale.length
  if (kept < SCREENSHOTS_TO_KEEP || !options.listLegacy) return
  const legacy = await options.listLegacy()
  await Promise.all(
    legacyScreenshotsToDelete(legacy.map((file) => file.name)).map((name) =>
      options.remove(`/tmp/${name}`)
    )
  )
}

// Removes one chat's directory and the old flat /tmp files. Used when a chat
// is deleted while its sandbox is still running.
export async function removeChatScreenshots(
  chatIds: string[],
  io: {
    run: (command: string) => Promise<{ exitCode: number; result: string }>
    remove: (path: string) => Promise<void>
  }
) {
  for (const chatId of chatIds) {
    const removed = await io.run(`rm -rf -- ${screenshotDirectory(chatId)}`)
    if (removed.exitCode !== 0) {
      throw new Error(
        removed.result || "Couldn't remove the chat's screenshots."
      )
    }
  }
  const listed = await io.run(
    "find /tmp -maxdepth 1 -type f -name 'meepo-screenshot-*.jpg'"
  )
  if (listed.exitCode !== 0) {
    throw new Error(listed.result || "Couldn't list old screenshots.")
  }
  const names = listed.result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((file) => file.slice(file.lastIndexOf("/") + 1))
  await Promise.all(
    legacyScreenshotsToDelete(names).map((name) => io.remove(`/tmp/${name}`))
  )
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
            error instanceof ScreenshotExpiredError
              ? EXPIRED
              : unavailable(error)
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
