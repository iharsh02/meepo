import assert from "node:assert/strict"
import test from "node:test"
import type { ModelMessage, ToolResultPart } from "ai"

import {
  prepareScreenshotMessages,
  screenshotPath,
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
})
