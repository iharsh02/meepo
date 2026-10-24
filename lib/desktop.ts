// Polls until the desktop reports "active", or throws once `timeoutMs` has
// passed. `start()` returns before xfce is ready to take a screenshot.
export async function waitUntilDesktopActive(
  status: () => Promise<string | undefined>,
  wait: (ms: number) => Promise<void>,
  timeoutMs = 15_000,
  now = Date.now
) {
  const deadline = now() + timeoutMs
  let current = await status()
  while (current !== "active") {
    if (now() >= deadline) {
      throw new Error("The sandbox desktop did not become ready.")
    }
    await wait(200)
    current = await status()
  }
}
