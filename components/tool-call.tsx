"use client"

import type { InferUITools, ToolUIPart } from "ai"

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import type { sandboxTools } from "@/trigger/sandbox-tools"

// A tool part of a bot message, typed per tool.
export type BotToolPart = ToolUIPart<InferUITools<typeof sandboxTools>>

// One tool call from the bot, as an AI Elements Tool: a header naming what it
// did, with its input and output tucked inside. Screens are special-cased:
// viewScreen (the bot looking for itself) never shows its image, and
// showScreen (the person asked to see) shows it under the header; both show
// the error if the screenshot failed.
export function ToolCall({ part }: { part: BotToolPart }) {
  if (part.type === "tool-viewScreen" || part.type === "tool-showScreen") {
    const shown = part.type === "tool-showScreen"
    return (
      <div className="mb-4 flex flex-col gap-2">
        <Tool className="mb-0">
          <ToolHeader
            type={part.type}
            state={part.state}
            title={shown ? "Screen" : "Looked at the screen"}
          />
          {part.state === "output-error" && (
            <ToolContent>
              <ToolOutput output={undefined} errorText={part.errorText} />
            </ToolContent>
          )}
        </Tool>
        {shown && part.state === "output-available" && (
          // eslint-disable-next-line @next/next/no-img-element -- inline base64 screenshot
          <img
            src={`data:${part.output.mediaType};base64,${part.output.base64}`}
            alt="The bot's screen"
            className="w-full rounded-md border"
          />
        )}
      </div>
    )
  }

  return (
    <Tool>
      <ToolHeader type={part.type} state={part.state} title={toolTitle(part)} />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput
          output={part.state === "output-available" ? part.output : undefined}
          errorText={part.state === "output-error" ? part.errorText : undefined}
        />
      </ToolContent>
    </Tool>
  )
}

// What the bot is doing while a call runs, for the chat's status line
// ("Running a command…").
export function toolActivity(part: BotToolPart) {
  switch (part.type) {
    case "tool-bash":
      return "Running a command"
    case "tool-readFile":
      return "Reading a file"
    case "tool-writeFile":
      return "Writing a file"
    case "tool-listFiles":
      return "Listing files"
    case "tool-mouseClick":
      return "Clicking"
    case "tool-mouseMove":
      return "Moving the mouse"
    case "tool-mouseScroll":
      return "Scrolling"
    case "tool-keyboardType":
      return "Typing"
    case "tool-keyboardPress":
      return "Pressing a key"
    case "tool-viewScreen":
      return "Looking at the screen"
    case "tool-showScreen":
      return "Taking a screenshot"
  }
}

// A short, plain description of a call, from whatever input has streamed in.
function toolTitle(part: BotToolPart) {
  switch (part.type) {
    case "tool-bash":
      return part.input?.command
        ? `Ran ${shorten(part.input.command)}`
        : "Ran a command"
    case "tool-readFile":
      return `Read ${part.input?.path ?? "a file"}`
    case "tool-writeFile":
      return `Wrote ${part.input?.path ?? "a file"}`
    case "tool-listFiles":
      return `Listed ${part.input?.path ?? "files"}`
    case "tool-mouseClick":
      return `Clicked at ${at(part.input)}`
    case "tool-mouseMove":
      return `Moved the mouse to ${at(part.input)}`
    case "tool-mouseScroll":
      return `Scrolled ${part.input?.direction ?? ""}`.trim()
    case "tool-keyboardType":
      // Not the text itself: it may be a password.
      return part.input?.text
        ? `Typed ${part.input.text.length} characters`
        : "Typed"
    case "tool-keyboardPress":
      return `Pressed ${[...(part.input?.modifiers ?? []), part.input?.key ?? "a key"].join("+")}`
    default:
      return part.type.slice("tool-".length)
  }
}

function at(input?: { x?: number; y?: number }) {
  return input?.x === undefined ? "a point" : `(${input.x}, ${input.y})`
}

function shorten(text: string) {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
