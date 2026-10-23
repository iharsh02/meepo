"use client"

import {
  createContext,
  use,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"

import type { BotChatMessage, ContextUsage } from "@/trigger/sandbox-tools"

const ContextUsageContext = createContext<{
  usage: ContextUsage | null
  setUsage: Dispatch<SetStateAction<ContextUsage | null>>
} | null>(null)

// Carries the chat's context usage from the conversation, which receives it
// on each reply, to the side panel's Context card. Wrap both in it (the chat
// page does); the conversation reports with useReportContextUsage(messages)
// and the card reads it with useContextUsage().
export function ContextUsageProvider({ children }: { children: ReactNode }) {
  const [usage, setUsage] = useState<ContextUsage | null>(null)
  return (
    <ContextUsageContext value={{ usage, setUsage }}>
      {children}
    </ContextUsageContext>
  )
}

function useContextUsageContext() {
  const context = use(ContextUsageContext)
  if (!context) {
    throw new Error(
      "Context usage parts must be inside <ContextUsageProvider>."
    )
  }
  return context
}

// The context usage of the latest reply that has one, or null before the
// first reply.
export function useContextUsage() {
  return useContextUsageContext().usage
}

// Reports the usage on the latest reply in `messages`, updating as it streams.
export function useReportContextUsage(messages: BotChatMessage[]) {
  const { setUsage } = useContextUsageContext()
  const latest = messages.findLast((message) => message.metadata?.context)
    ?.metadata?.context
  useEffect(() => {
    if (!latest) return
    setUsage((current) =>
      current?.used === latest.used && current.system === latest.system
        ? current
        : latest
    )
  }, [latest, setUsage])
}
