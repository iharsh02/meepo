"use client"

import { useState } from "react"
import {
  BlocksIcon,
  BrainIcon,
  FileSearchIcon,
  MonitorIcon,
  PaletteIcon,
  PaperclipIcon,
  PlugIcon,
  PlusIcon,
  ScrollTextIcon,
  type LucideIcon,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroupButton } from "@/components/ui/input-group"

const itemClass =
  "gap-3 rounded-lg px-2.5 py-2 text-[15px] [&_svg:not([class*='size-'])]:size-[18px]"
// Room for the checkmark on the right, drawn larger and blue.
const checkItemClass = `${itemClass} pr-9 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:right-2.5 [&_[data-slot=dropdown-menu-checkbox-item-indicator]_svg]:size-5 [&_[data-slot=dropdown-menu-checkbox-item-indicator]_svg]:text-blue-400`

// The composer's + menu. None of these are wired up yet: items do nothing,
// submenus only say "Coming soon", and the Research/Memory checks live in local
// state.
export function ComposerMenu() {
  const [research, setResearch] = useState(false)
  const [memory, setMemory] = useState(true)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<InputGroupButton size="icon-sm" className="rounded-lg" />}
      >
        <PlusIcon />
        <span className="sr-only">More options</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-72 rounded-xl p-1.5"
      >
        <DropdownMenuItem className={itemClass}>
          <PaperclipIcon />
          Upload or add files
          <DropdownMenuShortcut>Ctrl+U</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1.5" />
        <ComingSoonSub icon={ScrollTextIcon} label="Skills" />
        <ComingSoonSub icon={BlocksIcon} label="Connectors" />
        <ComingSoonSub icon={PaletteIcon} label="Design system" />
        <DropdownMenuItem className={itemClass}>
          <PlugIcon />
          Add plugins
        </DropdownMenuItem>
        <ComingSoonSub icon={MonitorIcon} label="Devices" />
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuCheckboxItem
          className={checkItemClass}
          checked={research}
          onCheckedChange={setResearch}
        >
          <FileSearchIcon />
          Research
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          className={checkItemClass}
          checked={memory}
          onCheckedChange={setMemory}
        >
          <BrainIcon />
          Memory
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ComingSoonSub({
  icon: Icon,
  label,
}: {
  icon: LucideIcon
  label: string
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={itemClass}>
        <Icon />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="rounded-xl p-1.5">
        <DropdownMenuItem disabled className={itemClass}>
          Coming soon
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
