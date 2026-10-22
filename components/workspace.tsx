"use client"

import {
  createContext,
  use,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react"
import { usePanelRef, type PanelImperativeHandle } from "react-resizable-panels"
import { cn } from "cn"

import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable"

const WorkspaceContext = createContext<{
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  panelRef: RefObject<PanelImperativeHandle | null>
} | null>(null)

// Shares the chat page's right-hand workspace panel between the panel and the
// header button that toggles it. Wrap the page's ResizablePanelGroup in it,
// put <WorkspacePanel /> last in the group, and call useWorkspace() in the
// button (app/(app)/chat/[botId]/page.tsx, components/chats-header.tsx).
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const panelRef = usePanelRef()
  const [open, setOpen] = useState(false)
  return (
    <WorkspaceContext value={{ open, setOpen, panelRef }}>
      {children}
    </WorkspaceContext>
  )
}

function useWorkspaceContext() {
  const workspace = use(WorkspaceContext)
  if (!workspace) {
    throw new Error("Workspace parts must be inside <WorkspaceProvider>.")
  }
  return workspace
}

// Whether the workspace is open, and a toggle that opens it at its last size
// or collapses it.
export function useWorkspace() {
  const { open, panelRef } = useWorkspaceContext()
  function toggle() {
    if (panelRef.current?.isCollapsed()) panelRef.current.expand()
    else panelRef.current?.collapse()
  }
  return { open, toggle }
}

// The right-hand workspace panel and its drag handle, showing `children` in a
// column that fills the panel's height. It
// starts collapsed, and counts as closed whenever it's collapsed, whether by
// the header button or by dragging it shut.
export function WorkspacePanel({ children }: { children: ReactNode }) {
  const { open, setOpen, panelRef } = useWorkspaceContext()
  return (
    <>
      <ResizableHandle className={cn(!open && "hidden")} />
      <ResizablePanel
        id="workspace"
        panelRef={panelRef}
        collapsible
        defaultSize={0}
        minSize="25%"
        maxSize="60%"
        onResize={(size) => setOpen(size.asPercentage > 0)}
        className="flex h-full flex-col"
        style={{ overflow: "hidden" }}
      >
        {children}
      </ResizablePanel>
    </>
  )
}
