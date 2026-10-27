"use client"

import type { ReactNode } from "react"
import { MonitorIcon } from "lucide-react"

import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useWorkspace } from "@/components/workspace"
import type { Bot } from "@/db/schema"

// The chat page's header: the chat's avatar and name, then `children` on the
// right (the direct chat page passes <WorkspaceButton />). Pass a direct
// chat's one bot, or a group's bots.
export function ChatsHeader({
  name,
  bots,
  children,
}: {
  name: string
  bots: Pick<Bot, "id" | "avatar">[]
  children?: ReactNode
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
      <SidebarTrigger className="md:hidden" />
      <div className="flex h-7 items-center gap-1 rounded-md pr-2.5 pl-1.5 text-[13px] font-medium">
        <GroupChatAvatar bots={bots} className="size-5" />
        {name}
      </div>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </header>
  )
}

// Toggles the workspace panel. Must sit inside <WorkspaceProvider>.
export function WorkspaceButton() {
  const { open, toggle } = useWorkspace()

  return (
    <Button
      variant={open ? "secondary" : "ghost"}
      size="icon-sm"
      className="rounded-md"
      aria-pressed={open}
      onClick={toggle}
    >
      <MonitorIcon />
      <span className="sr-only">
        {open ? "Close workspace" : "Open workspace"}
      </span>
    </Button>
  )
}
