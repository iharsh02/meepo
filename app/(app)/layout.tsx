import { cookies } from "next/headers"

import { AppSidebar } from "@/components/app-sidebar"
import { BotsDialog } from "@/components/bots-dialog"
import { NewGroupDialog } from "@/components/new-group-dialog"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { requireUser } from "@/lib/auth"
import { caller } from "@/trpc/server"

// Everything in (app) needs a signed-in user.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()
  const bots = await caller.bots.list()
  // The sidebar writes its open/collapsed state to this cookie.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false"

  return (
    <SidebarProvider
      defaultOpen={sidebarOpen}
      style={{ "--sidebar-width-icon": "4rem" } as React.CSSProperties}
    >
      <AppSidebar bots={bots} user={user} />
      {/* Pinned to the viewport height so pages scroll inside themselves (the
          chat page scrolls only its messages), never the whole window. */}
      <SidebarInset className="h-svh min-w-0">{children}</SidebarInset>
      <BotsDialog />
      <NewGroupDialog bots={bots} />
    </SidebarProvider>
  )
}
