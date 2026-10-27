import { UsersIcon } from "lucide-react"

import { BotFace } from "@/components/bot-face"
import type { Bot } from "@/db/schema"
import { cn } from "@/lib/utils"

// Where each item sits in the square, by how many items there are: one fills
// it, two sit side by side overlapping, three form a triangle, four fill a 2x2
// grid. Percentages, so the layout scales with the avatar's size.
const layouts = [
  [],
  ["inset-0 size-full"],
  [
    "top-1/2 left-0 size-[62%] -translate-y-1/2",
    "top-1/2 right-0 size-[62%] -translate-y-1/2",
  ],
  [
    "top-0 left-1/4 size-1/2",
    "bottom-0 left-0 size-1/2",
    "bottom-0 right-0 size-1/2",
  ],
  [
    "top-0 left-0 size-1/2",
    "top-0 right-0 size-1/2",
    "bottom-0 left-0 size-1/2",
    "bottom-0 right-0 size-1/2",
  ],
]

// A chat's avatar: up to three of its bots' faces, and a "+N" for the rest,
// packed into the space of a single <BotFace /> so a group takes up the same
// room as a direct chat in the sidebar and chat header. Size it with a
// `size-*` class, like BotFace.
export function GroupChatAvatar({
  bots,
  className,
}: {
  bots: Pick<Bot, "id" | "avatar">[]
  className?: string
}) {
  if (bots.length === 0) {
    return (
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground",
          className
        )}
      >
        <UsersIcon className="size-1/2" />
      </div>
    )
  }

  const faces = bots.slice(0, 3)
  const rest = bots.length - faces.length
  const layout = layouts[faces.length + (rest > 0 ? 1 : 0)] ?? []

  return (
    <div className={cn("@container relative size-8 shrink-0", className)}>
      {faces.map((bot, index) => (
        <BotFace
          key={bot.id}
          seed={bot.avatar}
          className={cn("absolute", layout[index])}
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "absolute flex items-center justify-center rounded-full bg-muted text-[20cqw] leading-none font-semibold text-foreground",
            layout[3]
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  )
}
