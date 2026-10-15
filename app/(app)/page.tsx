import { BotFace } from "@/components/bot-face"
import { CreateBotButton } from "@/components/bots-dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default function HomePage() {
  return (
    <div className="flex h-svh flex-col">
      <SidebarTrigger className="m-2 md:hidden" />
      <Empty>
        <EmptyHeader className="max-w-96">
          <EmptyMedia>
            {/* New seed per request, so every refresh shows a different face. */}
            <BotFace seed={crypto.randomUUID()} className="size-12" />
          </EmptyMedia>
          <EmptyTitle>Meet your first bot</EmptyTitle>
          <EmptyDescription>
            Every bot gets its own personality, memory, and face. Spin one up
            and start the conversation.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <CreateBotButton />
        </EmptyContent>
      </Empty>
    </div>
  )
}
