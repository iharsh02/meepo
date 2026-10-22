"use client"

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "cn"

import { getBotScreenUrl } from "@/app/(app)/chat/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useWorkspace } from "@/components/workspace"

type Slot = "panel" | "dialog"
// "idle" means a URL is wanted: it's fetched while the workspace is open.
// `attempt` changes on every fetch, so a reconnect reloads the iframe even when
// the server hands back the same URL.
type Screen =
  | { status: "idle" }
  | { status: "ready"; url: string; expiresAt: number; attempt: number }
  | { status: "error"; error: string }

const ScreenContext = createContext<{
  screen: Screen
  reconnect: () => void
  iframe: RefObject<HTMLIFrameElement | null>
  registerSlot: (slot: Slot, element: HTMLElement | null) => void
} | null>(null)

function useScreen() {
  const context = use(ScreenContext)
  if (!context) {
    throw new Error(
      "Sandbox screen parts must be inside <SandboxScreenProvider>."
    )
  }
  return context
}

// The screen's connection status and a way to reconnect it, for the side
// panel's Environment card. Must sit inside <SandboxScreenProvider>.
export function useScreenConnection() {
  const { screen, reconnect } = useScreen()
  return { status: screen.status, reconnect }
}

// Refetch this long before the signed URL expires.
const REFRESH_EARLY = 5 * 60 * 1000

// One live VNC view of the bot's desktop, shared by the workspace panel and
// the fullscreen dialog. Its URL is fetched once the workspace opens (which
// starts the sandbox's desktop), refetched shortly before it expires, and on
// "Reconnect" or "Try again". The iframe is rendered once, in a fixed layer at
// the end of <body>, and laid over whichever slot is showing (the dialog's,
// else the panel's), so moving between them never reloads it. Over the panel
// it ignores the pointer, so a click opens the dialog; over the dialog it takes
// mouse and keyboard input. Must sit inside <WorkspaceProvider>; key it by bot
// so switching bots starts fresh.
export function SandboxScreenProvider({
  botId,
  children,
}: {
  botId: string
  children: ReactNode
}) {
  const { open } = useWorkspace()
  const [screen, setScreen] = useState<Screen>({ status: "idle" })
  const [slots, setSlots] = useState<Record<Slot, HTMLElement | null>>({
    panel: null,
    dialog: null,
  })
  const fetching = useRef(false)
  const attempts = useRef(0)
  const iframe = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!open || screen.status !== "idle" || fetching.current) return
    fetching.current = true
    getBotScreenUrl(botId)
      .then(({ screen: next, error }) =>
        setScreen(
          next
            ? { status: "ready", ...next, attempt: ++attempts.current }
            : { status: "error", error: error ?? "" }
        )
      )
      .catch(() =>
        setScreen({
          status: "error",
          error: "Couldn't start the bot's desktop. Try again.",
        })
      )
      .finally(() => {
        fetching.current = false
      })
  }, [open, screen.status, botId])

  useEffect(() => {
    if (screen.status !== "ready") return
    const timer = setTimeout(
      () => setScreen({ status: "idle" }),
      Math.max(0, screen.expiresAt - Date.now() - REFRESH_EARLY)
    )
    return () => clearTimeout(timer)
  }, [screen])

  const reconnect = useCallback(() => setScreen({ status: "idle" }), [])

  const registerSlot = useCallback(
    (slot: Slot, element: HTMLElement | null) => {
      setSlots((current) =>
        current[slot] === element ? current : { ...current, [slot]: element }
      )
    },
    []
  )

  return (
    <ScreenContext value={{ screen, reconnect, iframe, registerSlot }}>
      {children}
      {screen.status === "ready" &&
        createPortal(
          <ScreenLayer
            key={screen.attempt}
            url={screen.url}
            iframe={iframe}
            target={open ? (slots.dialog ?? slots.panel) : null}
            interactive={slots.dialog !== null}
          />,
          document.body
        )}
    </ScreenContext>
  )
}

// The iframe itself, kept over `target` while there is one (one rect read per
// frame, only while the workspace is open). Hidden, but still connected, while
// there isn't.
function ScreenLayer({
  url,
  iframe,
  target,
  interactive,
}: {
  url: string
  iframe: RefObject<HTMLIFrameElement | null>
  target: HTMLElement | null
  interactive: boolean
}) {
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const style = layer.current?.style
    if (!style) return
    if (!target) {
      style.visibility = "hidden"
      return
    }
    const slot = target
    let frame = 0
    const place = () => {
      const rect = slot.getBoundingClientRect()
      style.visibility = rect.width && rect.height ? "visible" : "hidden"
      style.transform = `translate(${rect.left}px, ${rect.top}px)`
      style.width = `${rect.width}px`
      style.height = `${rect.height}px`
      frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [target])

  return (
    <div
      ref={layer}
      className={cn(
        "fixed top-0 left-0 overflow-hidden rounded-md",
        // Above the page under the panel; above the dialog (z-50) in it.
        interactive ? "pointer-events-auto z-60" : "pointer-events-none z-10"
      )}
      style={{ visibility: "hidden" }}
    >
      {/* Clipboard write only: the desktop may copy to your clipboard, but
          can't read it. */}
      <iframe
        ref={iframe}
        src={url}
        title="The bot's desktop"
        className="size-full border-0"
        allow="clipboard-write"
      />
    </div>
  )
}

// Marks where the screen shows: a box the layer is laid over while mounted.
function ScreenSlot({ slot, className }: { slot: Slot; className?: string }) {
  const { registerSlot } = useScreen()
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      registerSlot(slot, element)
      return () => registerSlot(slot, null)
    },
    [registerSlot, slot]
  )
  return <div ref={ref} className={className} />
}

// The bot's desktop as a preview, at the top of the workspace panel, that
// opens it full screen when clicked. The Environment card below it has the
// Reconnect button, for when the connection drops (e.g. after Daytona stopped
// the idle sandbox). The preview is sized to the desktop's 4:3 shape (Daytona's default
// 1024×768), so noVNC fills it instead of centring a smaller desktop.
export function SandboxScreenPreview({ botName }: { botName: string }) {
  const { screen, reconnect } = useScreen()
  const [fullscreen, setFullscreen] = useState(false)

  return (
    <div className="relative aspect-4/3 w-full shrink-0 bg-muted/30">
      <ScreenSlot slot="panel" className="absolute inset-0" />
      {screen.status === "ready" ? (
        <button
          type="button"
          className="absolute inset-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => setFullscreen(true)}
          aria-label={`Open ${botName}'s desktop full screen`}
        />
      ) : (
        <ScreenStatus screen={screen} onRetry={reconnect} />
      )}
      <ScreenDialog
        botName={botName}
        open={fullscreen}
        onClose={() => setFullscreen(false)}
      />
    </div>
  )
}

function ScreenStatus({
  screen,
  onRetry,
}: {
  screen: Screen
  onRetry: () => void
}) {
  if (screen.status === "error") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-destructive">
        {screen.error}
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      Starting the desktop…
    </div>
  )
}

// The desktop full screen, taking mouse and keyboard input: focus goes into
// the desktop when it opens, not to the close button, so the first keys typed
// reach the desktop. Only the close button closes it; Escape, clicks outside
// and focus leaving are all ignored, so working in the desktop can't dismiss it
// by accident. It's non-modal so the screen layer (outside the popup's DOM) can
// hold keyboard focus.
function ScreenDialog({
  botName,
  open,
  onClose,
}: {
  botName: string
  open: boolean
  onClose: () => void
}) {
  const { iframe } = useScreen()

  return (
    <Dialog
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (next) return
        if (details.reason === "close-press") onClose()
        else details.cancel()
      }}
      onOpenChangeComplete={(opened) => {
        if (!opened) return
        iframe.current?.focus()
        iframe.current?.contentWindow?.focus()
      }}
    >
      <DialogContent
        initialFocus={false}
        className="flex h-[calc(100svh-4rem)] w-[calc(100vw-4rem)] max-w-none flex-col gap-3 p-3 sm:max-w-none"
      >
        <DialogHeader className="pr-10 pl-1">
          <DialogTitle>{botName}&apos;s desktop</DialogTitle>
        </DialogHeader>
        <ScreenSlot
          slot="dialog"
          className="min-h-0 flex-1 rounded-md bg-muted/30"
        />
      </DialogContent>
    </Dialog>
  )
}
