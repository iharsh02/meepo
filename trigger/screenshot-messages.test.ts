import assert from "node:assert/strict"
import test from "node:test"
import type { ModelMessage, ToolResultPart } from "ai"

import {
  createScreenshotLoader,
  prepareScreenshotMessages,
  readScreenshotBytes,
  screenshotPath,
  screenshotsToDelete,
} from "./screenshot-messages"

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
]

function reference(id: string): ToolResultPart {
  return {
    type: "tool-result",
    toolName: "viewScreen",
    toolCallId: id,
    output: {
      type: "json",
      value: { id, width: 1024, height: 768, mediaType: "image/jpeg" },
    },
  }
}

test("loads only the latest two references, including results in the same message", async () => {
  const messages: ModelMessage[] = [
    { role: "tool", content: ids.map(reference) },
  ]
  const original = JSON.stringify(messages)
  const loaded: string[] = []
  const prepared = await prepareScreenshotMessages(messages, async (id) => {
    loaded.push(id)
    return `image-${id}`
  })

  assert.deepEqual(loaded, [ids[2], ids[1]])
  assert.equal(JSON.stringify(messages), original)
  assert.ok(!original.includes("base64"))
  assert.match(JSON.stringify(prepared), /Older screenshot removed/)
  assert.match(JSON.stringify(prepared), new RegExp(`image-${ids[2]}`))
  assert.ok(!JSON.stringify(prepared).includes(`image-${ids[0]}`))
})

test("shares the image limit with showScreen and supports legacy inline results", async () => {
  const legacy: ToolResultPart = {
    ...reference(ids[0]),
    output: {
      type: "json",
      value: {
        base64: "legacy-image",
        width: 1024,
        height: 768,
        mediaType: "image/jpeg",
      },
    },
  }
  const shown: ToolResultPart = {
    ...reference(ids[1]),
    toolName: "showScreen",
    output: {
      type: "content",
      value: [
        {
          type: "file",
          mediaType: "image/jpeg",
          data: { type: "data", data: "shown-image" },
        },
      ],
    },
  }
  const prepared = await prepareScreenshotMessages(
    [{ role: "tool", content: [reference(ids[2]), legacy, shown] }],
    async () => assert.fail("Older references must not be downloaded")
  )
  assert.match(JSON.stringify(prepared), /legacy-image/)
  assert.match(JSON.stringify(prepared), /shown-image/)
})

test("missing images become an instruction to take a new screenshot", async () => {
  const prepared = await prepareScreenshotMessages(
    [{ role: "tool", content: [reference(ids[0])] }],
    async () => {
      throw new Error("File no longer exists")
    }
  )
  assert.match(JSON.stringify(prepared), /Screenshot unavailable/)
  assert.ok(!JSON.stringify(prepared).includes("File no longer exists"))
})

test("later steps reuse hydrated images and discard them as newer screenshots arrive", async () => {
  const first = await prepareScreenshotMessages(
    [{ role: "tool", content: [reference(ids[0]), reference(ids[1])] }],
    async (id) => `image-${id}`
  )
  const loaded: string[] = []
  const next = await prepareScreenshotMessages(
    [...first, { role: "tool", content: [reference(ids[2])] }],
    async (id) => {
      loaded.push(id)
      return `image-${id}`
    }
  )
  assert.deepEqual(loaded, [ids[2]])
  assert.ok(!JSON.stringify(next).includes(`image-${ids[0]}`))
  assert.match(JSON.stringify(next), new RegExp(`image-${ids[1]}`))
  assert.match(JSON.stringify(next), new RegExp(`image-${ids[2]}`))
})

function inline(id: string, data: string): ToolResultPart {
  return {
    ...reference(id),
    output: {
      type: "content",
      value: [
        {
          type: "file",
          mediaType: "image/jpeg",
          data: { type: "data", data },
        },
      ],
    },
  }
}

test("replaces an older inline screenshot beyond the newest two", async () => {
  const prepared = await prepareScreenshotMessages(
    [
      {
        role: "tool",
        content: [
          inline(ids[0], "old-inline"),
          reference(ids[1]),
          reference(ids[2]),
        ],
      },
    ],
    async (id) => `image-${id}`
  )
  const json = JSON.stringify(prepared)
  assert.match(json, /Older screenshot removed/)
  assert.equal(json.includes("old-inline"), false)
  assert.match(json, new RegExp(`image-${ids[1]}`))
  assert.match(json, new RegExp(`image-${ids[2]}`))
})

test("a failed load among the newest two falls back", async () => {
  const prepared = await prepareScreenshotMessages(
    [{ role: "tool", content: [reference(ids[0]), reference(ids[1])] }],
    async (id) => {
      if (id === ids[1]) throw new Error("disk read failed")
      return `image-${id}`
    }
  )
  const json = JSON.stringify(prepared)
  assert.match(json, new RegExp(`image-${ids[0]}`))
  assert.match(json, /Screenshot unavailable/)
  assert.equal(json.includes("disk read failed"), false)
  assert.equal(json.includes("Older screenshot removed"), false)
})

test("a stopped sandbox gives placeholders without starting it", async () => {
  for (const state of ["stopped", "archived", "starting"]) {
    const calls: string[] = []
    const sandbox = {
      state,
      async start() {
        calls.push("start")
      },
      async waitUntilStarted() {
        calls.push("wait")
      },
      async waitUntilStopped() {
        calls.push("wait-stop")
      },
      async download() {
        calls.push("download")
        return new Uint8Array()
      },
    }
    const load = createScreenshotLoader({
      chatId: "chat_1",
      lookup: async () => {
        calls.push("lookup")
        return sandbox
      },
    })
    const prepared = await prepareScreenshotMessages(
      [{ role: "tool", content: [reference(ids[0]), reference(ids[1])] }],
      load
    )
    assert.deepEqual(calls, ["lookup"])
    const json = JSON.stringify(prepared)
    assert.equal(json.match(/Screenshot expired/g)?.length, 2)
    assert.equal(json.includes("Screenshot unavailable"), false)
  }
})

test("loads a legacy screenshot when the chat file is missing", async () => {
  const paths: string[] = []
  const load = createScreenshotLoader({
    chatId: "chat_1",
    signal: new AbortController().signal,
    lookup: async () => ({
      state: "started",
      async download(path, signal) {
        paths.push(path)
        assert.ok(signal)
        if (path.startsWith("/tmp/meepo-screenshots/")) {
          throw new Error("missing")
        }
        return Buffer.from("legacy-bytes")
      },
    }),
  })
  const prepared = await prepareScreenshotMessages(
    [{ role: "tool", content: [reference(ids[0])] }],
    load
  )
  assert.deepEqual(paths, [
    `/tmp/meepo-screenshots/chat_1/${ids[0]}.jpg`,
    `/tmp/meepo-screenshot-${ids[0]}.jpg`,
  ])
  assert.match(
    JSON.stringify(prepared),
    new RegExp(Buffer.from("legacy-bytes").toString("base64"))
  )
})

test("downloads the newest screenshots in parallel from one lookup", async () => {
  let active = 0
  let max = 0
  let lookups = 0
  const load = createScreenshotLoader({
    chatId: "chat_1",
    lookup: async () => {
      lookups += 1
      return {
        state: "started",
        async download() {
          active += 1
          max = Math.max(max, active)
          await new Promise((resolve) => setTimeout(resolve, 20))
          active -= 1
          return Buffer.from("img")
        },
      }
    },
  })
  await prepareScreenshotMessages(
    [{ role: "tool", content: [reference(ids[0]), reference(ids[1])] }],
    load
  )
  assert.equal(lookups, 1)
  assert.equal(max, 2)
})

test("passes an abort signal through to the download", async () => {
  const controller = new AbortController()
  let seen: AbortSignal | undefined
  const bytes = await readScreenshotBytes(
    {
      async downloadFile() {
        throw new Error("should stream")
      },
      async downloadFileStream(_path, options) {
        seen = options?.signal
        return (async function* () {
          yield Uint8Array.from([1, 2])
        })()
      },
    },
    `/tmp/meepo-screenshot-${ids[0]}.jpg`,
    controller.signal
  )
  assert.equal(seen, controller.signal)
  assert.equal(
    Buffer.from(bytes).toString("base64"),
    Buffer.from([1, 2]).toString("base64")
  )
})

test("an aborted download is not replaced with a placeholder", async () => {
  await assert.rejects(
    () =>
      prepareScreenshotMessages(
        [{ role: "tool", content: [reference(ids[0])] }],
        async () => {
          throw new DOMException("aborted", "AbortError")
        }
      ),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError"
  )
})

test("pruning keeps only the newest screenshot files", () => {
  const dirId = "10000000-0000-4000-8000-000000000004"
  const stale = screenshotsToDelete([
    { name: "notes.txt", modifiedAt: "2026-01-04T00:00:00.000Z" },
    { name: `${ids[0]}.jpg`, modifiedAt: "2026-01-01T00:00:00.000Z" },
    { name: `${ids[1]}.jpg`, modifiedAt: "2026-01-02T00:00:00.000Z" },
    { name: `${ids[2]}.jpg`, modifiedAt: "2026-01-03T00:00:00.000Z" },
    {
      name: `${dirId}.jpg`,
      modifiedAt: "2026-01-05T00:00:00.000Z",
      isDir: true,
    },
    { name: "../etc/passwd", modifiedAt: "2026-01-06T00:00:00.000Z" },
    { name: "not-a-uuid.jpg", modifiedAt: "2026-01-06T00:00:00.000Z" },
  ])
  assert.deepEqual(stale, [`${ids[0]}.jpg`])
})

test("does not change other tools or interpret arbitrary paths as screenshot ids", async () => {
  const messages: ModelMessage[] = [
    {
      role: "tool",
      content: [
        { ...reference(ids[0]), toolName: "readFile" },
        reference("../../secret"),
        {
          ...reference(ids[1]),
          output: { type: "error-text", value: "Screenshot failed" },
        },
      ],
    },
  ]
  const prepared = await prepareScreenshotMessages(messages, async () =>
    assert.fail("Must not load")
  )
  assert.deepEqual(prepared, messages)
  assert.throws(() => screenshotPath("../../secret"))
  assert.throws(() => screenshotPath(ids[0], ".."))
  assert.throws(() => screenshotPath(ids[0], "a/b"))
  assert.throws(() => screenshotPath(ids[0], "a.b"))
  assert.equal(
    screenshotPath(ids[0], "abcDEF_12-"),
    `/tmp/meepo-screenshots/abcDEF_12-/${ids[0]}.jpg`
  )
  assert.equal(screenshotPath(ids[0]), `/tmp/meepo-screenshot-${ids[0]}.jpg`)
})
