"use client"

import {
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react"
import Link from "next/link"

import { BotFace } from "@/components/bot-face"
import { InputGroupTextarea } from "@/components/ui/input-group"
import type { Bot } from "@/db/schema"
import { cn } from "@/lib/utils"

// What a group chat's mentions need to know about a bot.
export type MentionBot = Pick<Bot, "id" | "name" | "avatar" | "job">

// Matches "@Name" for any of `bots`, ignoring case, and not inside a word
// (an email address) or when the name runs on into a longer word, in any
// alphabet ("@senécal" isn't "@sen"). Longest names first, so "@Ada Lovelace" wins over "@Ada". Only call with at least
// one bot.
function mentionPattern(bots: MentionBot[]) {
  const names = bots
    .map((bot) => bot.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
  return new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_@])@(${names.join("|")})(?![\\p{L}\\p{M}\\p{N}_-])`,
    "giu"
  )
}

// `text` cut into plain runs and mentions, in order. Each piece keeps the
// text exactly as typed ("@SEN" stays "@SEN"); mentions also carry the bot.
function splitMentions(text: string, bots: MentionBot[]) {
  if (bots.length === 0) return [{ text, at: 0 }]
  const pieces: { text: string; at: number; bot?: MentionBot }[] = []
  let from = 0
  for (const match of text.matchAll(mentionPattern(bots))) {
    const name = match[1]
    const bot = name
      ? bots.find((bot) => bot.name.toLowerCase() === name.toLowerCase())
      : undefined
    if (!bot) continue
    pieces.push({ text: text.slice(from, match.index), at: from })
    pieces.push({ text: match[0], at: match.index, bot })
    from = match.index + match[0].length
  }
  pieces.push({ text: text.slice(from), at: from })
  return pieces
}

// The first group bot `text` mentions as "@Name", which is the bot that
// answers it. Undefined when it mentions none.
export function mentionedBot(text: string, bots: MentionBot[]) {
  return splitMentions(text, bots).find((piece) => piece.bot)?.bot
}

// A person's group message with each "@Name" as a link to that bot's own
// chat. A message that mentions no bot starts with a link to `sentTo`, the bot
// it went to, so every message shows who it was for.
export function MentionText({
  text,
  bots,
  sentTo,
}: {
  text: string
  bots: MentionBot[]
  sentTo?: MentionBot
}) {
  const pieces = splitMentions(text, bots)
  return (
    <>
      {sentTo && !pieces.some((piece) => piece.bot) && (
        <>
          <MentionLink bot={sentTo} />{" "}
        </>
      )}
      {pieces.map((piece) =>
        piece.bot ? <MentionLink key={piece.at} bot={piece.bot} /> : piece.text
      )}
    </>
  )
}

// The composer's text with its mentions in the same blue as a sent message's.
// It sits behind a textarea with transparent text (MentionTextarea), so it
// must lay out exactly like the textarea: same characters, same width. The
// mentions are made bolder with a text stroke, which doesn't widen them.
function MentionHighlights({
  text,
  bots,
}: {
  text: string
  bots: MentionBot[]
}) {
  return splitMentions(text, bots).map((piece) =>
    piece.bot ? (
      <span key={piece.at} className={mentionColor}>
        {piece.text}
      </span>
    ) : (
      piece.text
    )
  )
}

// The blue a mention shows in, sent or being typed.
const mentionColor =
  "text-sky-700 [-webkit-text-stroke:0.4px_currentColor] dark:text-sky-300"

function MentionLink({ bot }: { bot: MentionBot }) {
  return (
    <Link
      href={`/chat/${bot.id}`}
      className={cn(mentionColor, "hover:underline")}
    >
      @{bot.name}
    </Link>
  )
}

// The "@" list for a composer textarea. While the text before the caret ends
// in "@query", it offers the group's bots whose names contain the query;
// picking one replaces "@query" with "@Name ". Call trackCaret from the
// textarea's onChange and onSelect, and run onKeyDown before the composer's
// own keys: it returns true when it handled the key (arrows, Enter, Tab, Esc
// while the list is open). Offers nothing with fewer than two bots.
export function useMentionMenu({
  bots,
  text,
  setText,
  textarea,
}: {
  bots: MentionBot[]
  text: string
  setText: (text: string) => void
  textarea: () => HTMLTextAreaElement | null
}) {
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  // The text before the caret when Esc closed the list, so it stays closed
  // until the person types again.
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)

  const before = text.slice(0, caret)
  const query =
    bots.length > 1 ? /(?:^|\s)@([^\s@]*)$/.exec(before)?.[1] : undefined
  const matches =
    query === undefined
      ? []
      : bots.filter((bot) =>
          bot.name.toLowerCase().includes(query.toLowerCase())
        )
  // A fully typed name needs no list, so Enter after "@sen" sends.
  const typedInFull = bots.some(
    (bot) => bot.name.toLowerCase() === query?.toLowerCase()
  )
  const open = matches.length > 0 && !typedInFull && dismissedAt !== before
  const index = Math.min(active, matches.length - 1)

  function trackCaret(element: HTMLTextAreaElement, typed: boolean) {
    setCaret(element.selectionStart)
    if (typed) setActive(0)
  }

  function pick(bot: MentionBot) {
    if (query === undefined) return
    const start = before.length - query.length - 1
    const inserted = `@${bot.name} `
    setText(text.slice(0, start) + inserted + text.slice(caret))
    const next = start + inserted.length
    setCaret(next)
    requestAnimationFrame(() => {
      textarea()?.focus()
      textarea()?.setSelectionRange(next, next)
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return false
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((index + step + matches.length) % matches.length)
    } else if (event.key === "Enter" || event.key === "Tab") {
      const bot = matches[index]
      if (bot) pick(bot)
    } else if (event.key === "Escape") {
      setDismissedAt(before)
    } else {
      return false
    }
    event.preventDefault()
    return true
  }

  return {
    trackCaret,
    onKeyDown,
    menu: open ? (
      <MentionMenu
        bots={matches}
        query={query ?? ""}
        active={index}
        onPick={pick}
      />
    ) : null,
  }
}

// The list itself, above the composer. Mouse-down keeps focus in the
// textarea, so a click picks without losing the caret.
function MentionMenu({
  bots,
  query,
  active,
  onPick,
}: {
  bots: MentionBot[]
  query: string
  active: number
  onPick: (bot: MentionBot) => void
}) {
  return (
    <div
      role="listbox"
      aria-label="Bots in this group"
      className="absolute bottom-full left-6 z-10 mb-1.5 w-72 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {bots.map((bot, index) => (
        <button
          key={bot.id}
          type="button"
          role="option"
          aria-selected={index === active}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(bot)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            index === active && "bg-accent text-accent-foreground"
          )}
        >
          <BotFace seed={bot.avatar} className="size-5" />
          <span className="font-medium">
            <HighlightedName name={bot.name} query={query} />
          </span>
          <span className="ml-auto truncate text-xs text-popover-foreground/75">
            {bot.job}
          </span>
        </button>
      ))}
      <p className="mt-1 border-t px-2 pt-1.5 pb-0.5 text-[11px] text-popover-foreground/75">
        ↑↓ choose · Enter insert · Esc close
      </p>
    </div>
  )
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const start = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (start < 0) return name
  const end = start + query.length
  return (
    <>
      {name.slice(0, start)}
      <span className={mentionColor}>{name.slice(start, end)}</span>
      {name.slice(end)}
    </>
  )
}

// The composer's textarea, with its "@Name" mentions shown in blue as they're
// typed. The textarea's own text is transparent (the caret and selection stay
// visible) over a copy of the text with the mentions colored, which follows
// the textarea's scroll. Both reserve the scrollbar's space, so lines wrap the
// same once the textarea scrolls. Takes InputGroupTextarea's props; the InputGroup
// around it needs `h-auto`, since the textarea is no longer its direct child.
export function MentionTextarea({
  bots,
  className,
  onScroll,
  ...props
}: ComponentProps<typeof InputGroupTextarea> & {
  bots: MentionBot[]
  value: string
}) {
  const backdrop = useRef<HTMLDivElement>(null)
  return (
    <div className="relative w-full">
      <div
        ref={backdrop}
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 [scrollbar-gutter:stable] overflow-hidden px-2.5 py-2 text-base wrap-break-word whitespace-pre-wrap text-foreground md:text-sm",
          className
        )}
      >
        <MentionHighlights text={props.value} bots={bots} />
        {/* Keeps a trailing newline's empty line, as the textarea does. */}
        {"\u200b"}
      </div>
      <InputGroupTextarea
        {...props}
        className={cn(
          "relative [scrollbar-gutter:stable] text-transparent caret-foreground selection:bg-sky-500/30 selection:text-transparent",
          className
        )}
        onScroll={(event) => {
          if (backdrop.current) {
            backdrop.current.scrollTop = event.currentTarget.scrollTop
          }
          onScroll?.(event)
        }}
      />
    </div>
  )
}
