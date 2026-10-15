import { redirect } from "next/navigation"

import { BotFace } from "@/components/bot-face"
import { GitHubSignInButton } from "@/components/github-sign-in-button"
import { getSession } from "@/lib/auth"

export default async function SignInPage() {
  if (await getSession()) redirect("/")

  return (
    <main className="flex h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <BotFace seed={crypto.randomUUID()} className="size-12" />
      <div className="flex flex-col gap-1">
        <h1 className="text-sm font-medium">Sign in to Meepo</h1>
        <p className="text-sm text-muted-foreground">Your bots are waiting.</p>
      </div>
      <GitHubSignInButton />
    </main>
  )
}
