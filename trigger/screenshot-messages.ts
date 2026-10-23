import type { ModelMessage } from "ai"
import { z } from "zod"

const screen = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  mediaType: z.literal("image/jpeg"),
})
const reference = screen.extend({ id: z.uuid() })
const legacyScreen = screen.extend({ base64: z.string() })

// Private screenshots stay inside the bot's sandbox, never at a public URL.
export function screenshotPath(id: string) {
  return `/tmp/meepo-screenshot-${z.uuid().parse(id)}.jpg`
}

// Expands only the newest screenshots for the model. The UI tool results and
// persisted transcript keep references; old inline screenshots remain readable.
// Walk parts backwards too, since several tool results can share one message.
export async function prepareScreenshotMessages(
  messages: ModelMessage[],
  load: (id: string) => Promise<string>,
  keep = 2
) {
  let seen = 0
  const result: ModelMessage[] = []
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool") {
      result.push(message)
      continue
    }
    const content: typeof message.content = []
    for (const part of [...message.content].reverse()) {
      if (
        part.type !== "tool-result" ||
        (part.toolName !== "viewScreen" && part.toolName !== "showScreen")
      ) {
        content.unshift(part)
        continue
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
      if (!saved.success && !legacy.success && !inline) {
        content.unshift(part)
        continue
      }
      seen += 1
      if (seen > keep) {
        content.unshift({
          ...part,
          output: {
            type: "text",
            value:
              "[Older screenshot removed to save space. Take a new one to see the screen.]",
          },
        })
        continue
      }
      if (inline) {
        content.unshift(part)
        continue
      }
      const image = saved.success
        ? saved.data
        : legacy.success
          ? legacy.data
          : null
      if (!image) continue
      let base64: string
      try {
        base64 = "id" in image ? await load(image.id) : image.base64
      } catch {
        content.unshift({
          ...part,
          output: {
            type: "text",
            value:
              "[Screenshot unavailable. Take a new screenshot before using the mouse or keyboard.]",
          },
        })
        continue
      }
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
