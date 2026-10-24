import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytona/sdk"

// Server-only Daytona client, configured from DAYTONA_API_KEY and DAYTONA_API_URL.
// Both are passed explicitly: the SDK refuses to start when a .env file in the
// working directory sets DAYTONA_API_URL (as Next.js and `trigger dev` load it)
// unless the caller names the endpoint itself.
const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
})

// Creates the sandbox a new bot owns and returns its id, for `bots.sandboxId`.
// Daytona boots a sandbox as part of creating it (there's no create-stopped
// option) and stops it again after 15 idle minutes.
export async function createSandbox() {
  const sandbox = await daytona.create()
  return sandbox.id
}

// Deletes a bot's sandbox. One that's already gone counts as deleted, so a
// retried bot deletion doesn't get stuck.
export async function deleteSandbox(sandboxId: string) {
  try {
    const sandbox = await daytona.get(sandboxId)
    await sandbox.delete()
  } catch (error) {
    if (error instanceof DaytonaNotFoundError) return
    throw error
  }
}

// A bot's sandbox, ready for commands. Daytona stops (or archives) an idle
// sandbox after 15 minutes, so this starts it again, or waits out a start or
// stop already under way. Used by the agent's tools (trigger/sandbox-tools.ts).
export async function getRunningSandbox(sandboxId: string) {
  const sandbox = await daytona.get(sandboxId)
  switch (sandbox.state) {
    case "started":
      break
    case "starting":
    case "restoring":
    case "resuming":
      await sandbox.waitUntilStarted()
      break
    case "stopping":
      await sandbox.waitUntilStopped()
      await sandbox.start()
      break
    default:
      await sandbox.start()
  }
  return sandbox
}

// The sandbox when it is already started. Never starts, resumes, or waits.
// Reloading a screenshot uses this: a stopped desktop would come back blank,
// and a text reply must not boot the machine to find that out.
export async function getStartedSandbox(sandboxId: string) {
  const sandbox = await daytona.get(sandboxId)
  return sandbox.state === "started" ? sandbox : null
}

// What the chat's side panel shows about a sandbox, without starting it:
// its state ("started", "stopped", ...), region, and size (memory and disk in
// GB).
export async function getSandboxInfo(sandboxId: string) {
  const { state, target, cpu, memory, disk } = await daytona.get(sandboxId)
  return { state, region: target, cpu, memory, disk }
}

// Starts the sandbox's desktop (Xvfb, xfce4 and VNC) if it isn't running, before
// any mouse, keyboard or screenshot call. It's checked every time rather than
// remembered, because the desktop stops whenever the sandbox does.
export async function startDesktop(sandbox: Sandbox) {
  const { status } = await sandbox.computerUse.getStatus()
  if (status !== "active") await sandbox.computerUse.start()
}

// The desktop's size in pixels, which mouse coordinates are measured in.
export async function screenSize(sandbox: Sandbox) {
  const { displays } = await sandbox.computerUse.display.getInfo()
  const screen = displays?.find((display) => display.isActive) ?? displays?.[0]
  if (!screen?.width || !screen.height) {
    throw new Error("The sandbox's desktop reported no screen size.")
  }
  return { width: screen.width, height: screen.height }
}

// noVNC (websockify) serves the desktop on this port in Daytona's default image.
const NOVNC_PORT = 6080
// Signed URLs last at most a day.
const SCREEN_URL_SECONDS = 24 * 60 * 60
const HOUR = 60 * 60 * 1000

const screenUrls = new Map<string, { url: string; expiresAt: number }>()

// A browser URL for the bot's live desktop (noVNC), for the chat's workspace
// panel, and when it expires. Starts the sandbox and its desktop first if
// needed, so calling it again also brings a stopped desktop back. It's a signed
// preview URL: bound to the noVNC port and time-limited, unlike the
// sandbox-wide preview token, which must never reach the browser. One URL is
// reused per sandbox until it's within an hour of expiring, because every new
// URL shows Daytona's preview warning page again.
export async function getScreenUrl(sandboxId: string) {
  const sandbox = await getRunningSandbox(sandboxId)
  await startDesktop(sandbox)

  const cached = screenUrls.get(sandboxId)
  if (cached && cached.expiresAt - Date.now() > HOUR) return cached

  const signed = await sandbox.getSignedPreviewUrl(
    NOVNC_PORT,
    SCREEN_URL_SECONDS
  )
  const url = new URL("/vnc.html", signed.url)
  url.searchParams.set("autoconnect", "true")
  url.searchParams.set("resize", "scale")
  url.searchParams.set("reconnect", "true")
  const screen = {
    url: url.toString(),
    expiresAt: Date.now() + SCREEN_URL_SECONDS * 1000,
  }
  screenUrls.set(sandboxId, screen)
  return screen
}
