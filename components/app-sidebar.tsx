"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { formatDistanceToNowStrict } from "date-fns"
import { LogOutIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react"

import { BotFace } from "@/components/bot-face"
import { botsDialog } from "@/components/bots-dialog"
import { newGroupDialog } from "@/components/new-group-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import type { SessionUser } from "@/lib/auth"
import { authClient } from "@/lib/auth-client"
import type { Bot } from "@/db/schema"
import { cn } from "@/lib/utils"

// The bot list. Collapses to a 4rem icon rail with ⌘B; ⌘K opens bot search.
export function AppSidebar({ bots, user }: { bots: Bot[]; user: SessionUser }) {
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pt-1 group-data-[collapsible=icon]:pt-2">
          <NewMenu />
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 items-center gap-2 rounded-md border border-input bg-input/30 px-2 text-sm text-muted-foreground outline-none group-data-[collapsible=icon]:size-12 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:text-sidebar-foreground hover:bg-input/50 group-data-[collapsible=icon]:hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <SearchIcon className="size-4 group-data-[collapsible=icon]:size-5" />
            <span className="group-data-[collapsible=icon]:sr-only">
              Search
            </span>
            <span className="ml-auto text-xs group-data-[collapsible=icon]:hidden">
              ⌘K
            </span>
          </button>
        </SidebarHeader>

        <SidebarContent className="px-2 pt-2">
          <SidebarMenu className="gap-1.5">
            {bots.map((bot) => (
              <SidebarMenuItem key={bot.id}>
                <SidebarMenuButton
                  size="lg"
                  tooltip={bot.name}
                  isActive={pathname === `/chat/${bot.id}`}
                  render={<Link href={`/chat/${bot.id}`} />}
                  className="gap-2 rounded-sm group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:p-2!"
                >
                  <BotFace seed={bot.avatar} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="leading-4.5 font-medium">
                        {bot.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNowStrict(bot.createdAt)}
                      </span>
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {bot.job}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter>
          <NavUser user={user} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <BotSearch bots={bots} open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}

// Signed-in user's menu. Add account-level items (settings, billing...) to the
// middle group.
function NavUser({ user }: { user: SessionUser }) {
  const router = useRouter()
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton className="h-10 gap-2 rounded-sm font-medium group-data-[collapsible=icon]:mx-auto data-popup-open:bg-sidebar-accent" />
            }
          >
            <UserAvatar user={user} />
            <span>{user.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={8}
            className="w-56"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 px-1.5 py-1.5 font-normal text-foreground">
                <UserAvatar user={user} className="size-8" />
                <div className="grid min-w-0 leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await authClient.signOut()
                router.push("/sign-in")
                router.refresh()
              }}
            >
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// GitHub avatar, falling back to the first letter of the name.
function UserAvatar({
  user,
  className,
}: {
  user: SessionUser
  className?: string
}) {
  return (
    <Avatar size="sm" className={cn("after:hidden", className)}>
      {user.image && <AvatarImage src={user.image} alt="" />}
      <AvatarFallback className="bg-purple-700 text-foreground">
        {user.name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

function NewMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="self-end rounded-md group-data-[collapsible=icon]:size-12 group-data-[collapsible=icon]:self-center group-data-[collapsible=icon]:[&_svg]:size-5"
          />
        }
      >
        <PlusIcon />
        <span className="sr-only">New</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => botsDialog.open(null)}>
          <PlusIcon />
          Create new bot
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => newGroupDialog.open(null)}>
          <UsersIcon />
          Create group chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BotSearch({
  bots,
  open,
  onOpenChange,
}: {
  bots: Bot[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search bots"
      description="Jump to a conversation"
    >
      <Command>
        <CommandInput placeholder="Search bots..." />
        <CommandList>
          <CommandEmpty>No bots found.</CommandEmpty>
          <CommandGroup>
            {bots.map((bot) => (
              <CommandItem
                key={bot.id}
                value={`${bot.name} ${bot.id}`}
                onSelect={() => {
                  router.push(`/chat/${bot.id}`)
                  onOpenChange(false)
                }}
              >
                <BotFace seed={bot.avatar} className="size-5" />
                {bot.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
