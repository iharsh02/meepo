"use client"

import { MonitorIcon } from "lucide-react"

import { BotFace } from "@/components/bot-face"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useWorkspace } from "@/components/workspace"
import type { Bot } from "@/db/schema"

// The chat page's header: the bot's face and name, and the desktop button that
// toggles the workspace panel. Must sit inside <WorkspaceProvider>.
export function ChatsHeader({ bot }: { bot: Bot }) {
  const { open, toggle } = useWorkspace()

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
      <SidebarTrigger className="md:hidden" />
      <div className="flex h-7 items-center gap-1 rounded-md pr-2.5 pl-1.5 text-[13px] font-medium">
        <BotFace seed={bot.avatar} className="size-5" />
        {bot.name}
      </div>
      <Button
        variant={open ? "secondary" : "ghost"}
        size="icon-sm"
        className="ml-auto rounded-md"
        aria-pressed={open}
        onClick={toggle}
      >
        <MonitorIcon />
        <span className="sr-only">
          {open ? "Close workspace" : "Open workspace"}
        </span>
      </Button>
    </header>
  )
}
