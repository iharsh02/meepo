import { z } from "zod"

import { cn } from "@/lib/utils"

const faceUrl = (seed: string, format: "svg" | "json") =>
  `https://api.dicebear.com/10.x/gaze/${format}?seed=${encodeURIComponent(seed)}&animationVariant=medium`

// A bot's face is an animated DiceBear "gaze" avatar (it looks around, blinks
// and hops; reduced-motion users get a still face). The seed picks the face, so
// shuffling a face means picking a new seed. Size it with a `size-*` class.
export function BotFace({
  seed,
  className,
}: {
  seed: string
  className?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote SVG, nothing for next/image to optimize
    <img
      src={faceUrl(seed, "svg")}
      alt=""
      className={cn("size-8 shrink-0", className)}
    />
  )
}

const faceOptionsSchema = z.object({
  options: z.object({
    bodyColor: z.array(z.string()).nonempty(),
    inkColor: z.array(z.string()).nonempty(),
  }),
})

export type BotFaceColors = { body: string; ink: string }

// Server only. The face's fill colour and its eye (ink) colour, so other UI can
// match a bot's face: `await getBotFaceColors(bot.avatar)`. DiceBear picks them
// from the seed, so the answer is cached for good. Null if DiceBear can't be
// reached.
export async function getBotFaceColors(
  seed: string
): Promise<BotFaceColors | null> {
  try {
    const res = await fetch(faceUrl(seed, "json"), { cache: "force-cache" })
    if (!res.ok) return null
    const { options } = faceOptionsSchema.parse(await res.json())
    return { body: options.bodyColor[0], ink: options.inkColor[0] }
  } catch {
    return null
  }
}
