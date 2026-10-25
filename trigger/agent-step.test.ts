import assert from "node:assert/strict"
import test from "node:test"
import type { ModelMessage } from "ai"
import { isStepCount, streamText, tool } from "ai"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { z } from "zod"

import { prepareAgentStep, type AgentStep } from "./prepare-step"
import { STOP_LOOKING } from "./screen-loop"
import { restoreDroppedStepMessages } from "./step-history"
import { retainStepMessages as retainStepMessagesUntyped } from "../node_modules/@trigger.dev/sdk/dist/esm/v3/steeringContext.js"

// chat.agent wraps prepareStep with this. Not a public export. AI SDK 7 keeps
// only the latest step on `response.messages`, so the slice drops every tool
// result after the first unless prepareStep puts them back.
const retainStepMessages = retainStepMessagesUntyped as <
  Args extends { messages: ModelMessage[]; steps: AgentStep[] },
>(
  prepare: (input: Args) => Promise<{ messages?: ModelMessage[] } | undefined>
) => (input: Args) => Promise<{ messages?: ModelMessage[] } | undefined>

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
}

type ModelStreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never

const SCREEN_ID = "00000000-0000-4000-8000-000000000001"
const SCREEN_BYTES = Buffer.from("desktop-jpeg").toString("base64")

function toolStream(id: string, name: string, input: unknown, text: string) {
  const encoded = JSON.stringify(input)
  const chunks: ModelStreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    { type: "tool-input-start", id, toolName: name },
    { type: "tool-input-delta", id, delta: encoded },
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName: name, input: encoded },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage,
    },
  ]
  return simulateReadableStream({ chunks })
}

function textStream(text: string) {
  const chunks: ModelStreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage,
    },
  ]
  return simulateReadableStream({ chunks })
}

const viewScreen = tool({
  description: "Look at the desktop.",
  inputSchema: z.object({}),
  execute: async () => ({
    id: SCREEN_ID,
    width: 1024,
    height: 768,
    mediaType: "image/jpeg" as const,
  }),
})

const bash = tool({
  description: "Run a command.",
  inputSchema: z.object({ command: z.string() }),
  execute: async ({ command }) => ({
    exitCode: 0,
    output: `result:${command}`,
  }),
})

type Turn =
  { tool: "viewScreen" } | { tool: "bash"; command: string } | { text: string }

// Runs the same prepareStep the agent uses, behind the Trigger.dev wrapper,
// and returns the prompt each model step actually received.
async function promptsFor(turns: Turn[]) {
  const prompts: unknown[] = []
  let step = 0
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      prompts.push(prompt)
      const turn = turns[step]
      step += 1
      if (!turn || "text" in turn) {
        return {
          stream: textStream(turn && "text" in turn ? turn.text : "done"),
        }
      }
      if (turn.tool === "viewScreen") {
        return {
          stream: toolStream(`call-${step}`, "viewScreen", {}, "looking"),
        }
      }
      return {
        stream: toolStream(
          `call-${step}`,
          "bash",
          { command: turn.command },
          "running"
        ),
      }
    },
  })
  const result = streamText({
    model,
    messages: [
      { role: "user", content: "Open the profile and send a screenshot." },
    ],
    tools: { viewScreen, bash },
    prepareStep: retainStepMessages(async ({ messages, steps }) => {
      const prepared = await prepareAgentStep({
        messages,
        steps,
        loadScreenshot: async () => SCREEN_BYTES,
      })
      return { messages: prepared.messages }
    }),
    stopWhen: isStepCount(turns.length),
  })
  await result.consumeStream()
  return prompts
}

function promptText(prompt: unknown) {
  return JSON.stringify(prompt)
}

function bashStep(id: string, command: string, output: string): AgentStep {
  const call = {
    type: "tool-call" as const,
    toolCallId: id,
    toolName: "bash",
    input: { command },
  }
  const assistant: ModelMessage = { role: "assistant", content: [call] }
  const result: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: "bash",
        output: { type: "json", value: { exitCode: 0, output } },
      },
    ],
  }
  return {
    toolCalls: [{ toolName: "bash", input: { command } }],
    response: { messages: [assistant, result] },
  }
}

test("later model steps still see every earlier tool result", async () => {
  const prompts = await promptsFor([
    { tool: "viewScreen" },
    { tool: "bash", command: "pgrep -a chromium" },
    { tool: "bash", command: "echo hi" },
    { text: "done" },
  ])
  assert.equal(prompts.length, 4)
  const first = promptText(prompts[0])
  assert.match(first, /Open the profile/)
  assert.equal(first.includes("tool-result"), false)

  const second = promptText(prompts[1])
  assert.match(second, /call-1/)
  assert.match(second, new RegExp(SCREEN_BYTES))

  // This is the step that used to be frozen on the first tool result.
  const third = promptText(prompts[2])
  assert.match(third, /call-1/)
  assert.match(third, new RegExp(SCREEN_BYTES))
  assert.match(third, /call-2/)
  assert.match(third, /result:pgrep -a chromium/)

  const fourth = promptText(prompts[3])
  assert.match(fourth, /call-1/)
  assert.match(fourth, /call-2/)
  assert.match(fourth, /result:pgrep -a chromium/)
  assert.match(fourth, /call-3/)
  assert.match(fourth, /result:echo hi/)
  assert.equal(fourth.split("call-2").length - 1, 2)
})

test("the repeat note arrives with the results, not instead of them", async () => {
  const prompts = await promptsFor([
    { tool: "bash", command: "pgrep -a chromium" },
    { tool: "bash", command: "pgrep -a chromium" },
    { text: "done" },
  ])
  const third = promptText(prompts[2])
  assert.match(third, /result:pgrep -a chromium/)
  assert.match(third, /call-1/)
  assert.match(third, /call-2/)
  assert.match(third, /repeating the same bash call \(pgrep -a chromium\)/)
  assert.match(third, /Do not run that call again/)
})

test("restore puts back only the steps the wrapper dropped", () => {
  const first = bashStep("call-1", "pgrep -a chromium", "498 chromium")
  const second = bashStep("call-2", "echo hi", "hi")
  const kept = [
    { role: "user" as const, content: "check" },
    ...first.response.messages,
  ]
  const restored = restoreDroppedStepMessages(kept, [first, second])
  const text = JSON.stringify(restored)
  assert.match(text, /call-1/)
  assert.match(text, /498 chromium/)
  assert.match(text, /call-2/)
  assert.match(text, /"hi"/)
  assert.equal(text.split("call-1").length - 1, 2)
})

test("restore leaves a complete history unchanged and keeps a trailing note last", () => {
  const first = bashStep("call-1", "pgrep -a chromium", "498 chromium")
  const note: ModelMessage = {
    role: "user",
    content: "You are repeating the same bash call.",
  }
  const messages = [
    { role: "user" as const, content: "check" },
    ...first.response.messages,
    note,
  ]
  const restored = restoreDroppedStepMessages(messages, [first])
  assert.deepEqual(restored, messages)

  const dropped = restoreDroppedStepMessages(
    [{ role: "user", content: "check" }, ...first.response.messages, note],
    [first, bashStep("call-2", "echo hi", "hi")]
  )
  assert.equal(dropped.at(-1), note)
  assert.match(JSON.stringify(dropped), /call-2/)
})

test("restore does not reattach steps when the first one is gone", () => {
  const first = bashStep("call-1", "pgrep -a chromium", "498 chromium")
  const summary: ModelMessage[] = [
    { role: "user", content: "check" },
    { role: "assistant", content: "Summary of earlier work." },
  ]
  assert.deepEqual(restoreDroppedStepMessages(summary, [first]), summary)
})

test("restore replaces a partial tool-message suffix with the whole step", () => {
  const first = bashStep("call-1", "true", "")
  const second = bashStep("call-2", "pgrep -a chromium", "498 chromium")
  const orphan = second.response.messages[1]
  assert.ok(orphan)
  const restored = restoreDroppedStepMessages(
    [{ role: "user", content: "check" }, ...first.response.messages, orphan],
    [first, second]
  )
  const text = JSON.stringify(restored)
  assert.match(text, /call-2/)
  assert.equal(text.split("call-2").length - 1, 2)
  assert.equal(restored.filter((message) => message.role === "tool").length, 2)
})

test("three looks without the mouse hide the screen tools", async () => {
  const steps = ["call-1", "call-2", "call-3"].map((id, index) => {
    const assistant: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: id,
          toolName: "viewScreen",
          input: {},
        },
      ],
    }
    const result: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName: "viewScreen",
          output: {
            type: "json",
            value: {
              id: `00000000-0000-4000-8000-00000000000${index + 1}`,
              width: 1024,
              height: 768,
              mediaType: "image/jpeg",
            },
          },
        },
      ],
    }
    const step: AgentStep = {
      toolCalls: [{ toolName: "viewScreen", input: {} }],
      response: { messages: [assistant, result] },
    }
    return step
  })
  const prepared = await prepareAgentStep({
    messages: [
      { role: "user", content: "look" },
      ...steps.flatMap((step) => step.response.messages),
    ],
    steps,
    loadScreenshot: async () => SCREEN_BYTES,
  })
  assert.equal(prepared.hideScreenTools, true)
  assert.equal(prepared.messages.at(-1)?.role, "user")
  assert.equal(
    prepared.messages.at(-1)?.role === "user" &&
      prepared.messages.at(-1)?.content,
    STOP_LOOKING
  )
})
