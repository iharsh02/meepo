"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import {
  ChevronRightIcon,
  CpuIcon,
  GlobeIcon,
  MonitorIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"

import { deleteBotAction } from "@/app/(app)/actions"
import { getBotSandbox } from "@/app/(app)/chat/actions"
import { BotFace } from "@/components/bot-face"
import { ConfigureBotButton } from "@/components/bots-dialog"
import { useContextUsage } from "@/components/context-usage"
import { useScreenConnection } from "@/components/sandbox-screen"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useWorkspace } from "@/components/workspace"
import type { Bot } from "@/db/schema"

// The workspace panel's cards under the bot's desktop: the bot with its
// Configure dialog, its sandbox, how full the chat's context is, its
// connectors, and deleting it. Scrolls on its own when the panel is short, so
// the desktop above stays put. Must sit inside <SandboxScreenProvider> and
// <ContextUsageProvider>.
export function AgentPanel({ bot }: { bot: Bot }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BotFace seed={bot.avatar} className="size-6" />
            {bot.name}
          </CardTitle>
          <CardDescription>{bot.job}</CardDescription>
          <CardAction>
            <ConfigureBotButton bot={bot} />
          </CardAction>
        </CardHeader>
        {bot.instructions && (
          <CardContent className="line-clamp-4 whitespace-pre-wrap">
            {bot.instructions}
          </CardContent>
        )}
      </Card>
      <EnvironmentCard botId={bot.id} />
      <ContextCard />
      <Card size="sm">
        <CardHeader>
          <CardTitle>Connectors</CardTitle>
          <CardAction className="text-muted-foreground">None yet</CardAction>
        </CardHeader>
      </Card>
      <DeleteBotButton bot={bot} />
    </div>
  )
}

// A card whose body folds away under its title, with a `summary` beside the
// title while it's folded.
function FoldingCard({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string
  summary: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} render={<Card size="sm" />}>
      <CollapsibleTrigger className="group/fold flex items-center gap-1 px-3 text-left text-sm font-medium outline-none focus-visible:underline">
        {title}
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-panel-open/fold:rotate-90" />
        <span className="ml-auto flex items-center gap-2 font-normal text-muted-foreground group-data-panel-open/fold:hidden">
          {summary}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <CardContent className="flex flex-col gap-2.5">{children}</CardContent>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-6 items-center gap-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {label}
      <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
        {children}
      </span>
    </div>
  )
}

type SandboxResult = Awaited<ReturnType<typeof getBotSandbox>>

// The bot's Daytona sandbox and the desktop connection, with Reconnect. The
// sandbox is looked up while the workspace is open, and again whenever the
// connection changes, since connecting starts a stopped sandbox.
function EnvironmentCard({ botId }: { botId: string }) {
  const { open } = useWorkspace()
  const connection = useScreenConnection()
  const [result, setResult] = useState<SandboxResult | null>(null)

  useEffect(() => {
    if (!open) return
    let current = true
    getBotSandbox(botId)
      .catch(() => ({ error: "Couldn't reach the bot's sandbox." }))
      .then((next) => {
        if (current) setResult(next)
      })
    return () => {
      current = false
    }
  }, [open, botId, connection.status])

  const sandbox = result && "sandbox" in result ? result.sandbox : null
  const state = sandbox?.state ?? (result ? "error" : undefined)

  return (
    <FoldingCard
      title="Environment"
      summary={state ? <SandboxState state={state} /> : null}
      defaultOpen
    >
      <Row icon={ServerIcon} label="Daytona sandbox">
        {state ? (
          <SandboxState state={state} />
        ) : (
          <Skeleton className="h-4 w-16" />
        )}
      </Row>
      <Row icon={GlobeIcon} label="Region">
        {sandbox ? sandbox.region : <Skeleton className="h-4 w-8" />}
      </Row>
      <Row icon={CpuIcon} label="Size">
        {sandbox ? (
          `${sandbox.cpu} vCPU · ${sandbox.memory} GB RAM · ${sandbox.disk} GB disk`
        ) : (
          <Skeleton className="h-4 w-32" />
        )}
      </Row>
      <Row icon={MonitorIcon} label="Desktop">
        {connection.status === "idle" ? (
          "Connecting…"
        ) : (
          <>
            {connection.status === "ready" ? "Connected" : "Not connected"}
            <Button
              variant="ghost"
              size="xs"
              className="-mr-2"
              onClick={connection.reconnect}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Reconnect
            </Button>
          </>
        )}
      </Row>
      {result && "error" in result && (
        <p className="text-destructive">{result.error}</p>
      )}
    </FoldingCard>
  )
}

// A sandbox state from Daytona ("started", "build_failed", ...) as a dot and
// a word: green while it runs, red when it failed, grey otherwise.
function SandboxState({ state }: { state: string }) {
  const failed = state === "error" || state === "build_failed"
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "size-1.5 rounded-full bg-muted-foreground",
          state === "started" && "bg-emerald-500",
          failed && "bg-destructive"
        )}
      />
      {state === "started"
        ? "Running"
        : state === "error"
          ? "Error"
          : state.charAt(0).toUpperCase() + state.slice(1).replaceAll("_", " ")}
    </span>
  )
}

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})

// 748600 → "748.6k", 1000000 → "1M".
function tokens(count: number) {
  return compact.format(count).replace("K", "k")
}

function percent(part: number, whole: number) {
  return `${((part / whole) * 100).toFixed(1)}%`
}

// How full the model's context window is, as of the latest reply, split like
// Claude Code's /context: messages, tools, system prompt and free space. The
// system prompt and tools shares are estimates (trigger/chat.ts). The colours
// follow Claude Code's; the theme's chart colours are all greys.
function ContextCard() {
  const usage = useContextUsage()

  if (!usage) {
    return (
      <FoldingCard title="Context" summary="0%">
        <p className="text-muted-foreground">
          How much of the model&apos;s context window this chat uses shows here
          after the bot&apos;s next reply.
        </p>
      </FoldingCard>
    )
  }

  const system = Math.min(usage.system, usage.used)
  const tools = Math.min(usage.tools, usage.used - system)
  const free = Math.max(0, usage.window - usage.used)
  const parts = [
    {
      label: "Messages",
      count: usage.used - system - tools,
      color: "bg-blue-500",
    },
    { label: "Tools", count: tools, color: "bg-orange-500" },
    { label: "System prompt", count: system, color: "bg-muted-foreground" },
  ]
  const used = Math.round((usage.used / usage.window) * 100)

  return (
    <FoldingCard
      title="Context"
      summary={
        <>
          {used}%
          <span className="h-1.5 w-8 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full bg-blue-500"
              style={{ width: `${Math.min(used, 100)}%` }}
            />
          </span>
        </>
      }
    >
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{used}% used</span>
        <span className="text-muted-foreground">
          {tokens(usage.used)} / {tokens(usage.window)}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${used}% of the context window used`}
        className="flex h-1.5 gap-px overflow-hidden rounded-full bg-muted"
      >
        {parts.map((part) => (
          <span
            key={part.label}
            className={part.color}
            style={{ width: percent(part.count, usage.window) }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        {[
          ...parts,
          { label: "Free space", count: free, color: "bg-muted" },
        ].map((part) => (
          <div key={part.label} className="flex items-center gap-2.5">
            <span className={cn("size-2.5 rounded-xs", part.color)} />
            {part.label}
            <span className="ml-auto text-muted-foreground tabular-nums">
              {tokens(part.count)}
            </span>
            <span className="w-12 text-right tabular-nums">
              {percent(part.count, usage.window)}
            </span>
          </div>
        ))}
      </div>
    </FoldingCard>
  )
}

// Deletes the bot after a confirmation. On success the action sends the
// browser home; on failure the dialog stays open with the error.
function DeleteBotButton({ bot }: { bot: Bot }) {
  const [error, setError] = useState<string | null>(null)
  const [deleting, startDeleting] = useTransition()

  function remove() {
    startDeleting(async () => {
      const result = await deleteBotAction(bot.id)
      setError(result.error)
    })
  }

  return (
    <AlertDialog onOpenChange={() => setError(null)}>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <Trash2Icon data-icon="inline-start" />
        Delete {bot.name}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {bot.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes {bot.name}, its sandbox with everything on it, and your
            chat with it. You can&apos;t undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={remove}
          >
            {deleting && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
