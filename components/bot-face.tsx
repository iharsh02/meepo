import { cn } from "@/lib/utils"

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
      src={`https://api.dicebear.com/10.x/gaze/svg?seed=${encodeURIComponent(seed)}&animationVariant=medium`}
      alt=""
      className={cn("size-8 shrink-0", className)}
    />
  )
}
