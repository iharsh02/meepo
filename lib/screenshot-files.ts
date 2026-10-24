import { getStartedSandbox } from "@/lib/daytona"
import { removeChatScreenshots } from "@/trigger/screenshot-messages"

// Deletes a chat's screenshots when that chat is going away and the sandbox
// is already running. A stopped sandbox is left alone: deleting it removes
// the disk, and starting it only to tidy files would boot the machine.
export async function deleteChatScreenshotFiles(
  sandboxId: string,
  chatIds: string[]
) {
  if (chatIds.length === 0) return
  const box = await getStartedSandbox(sandboxId)
  if (!box) return
  await removeChatScreenshots(chatIds, {
    async run(command) {
      const { exitCode, result } = await box.process.executeCommand(command)
      return { exitCode: exitCode ?? 1, result }
    },
    async remove(path) {
      await box.fs.deleteFile(path)
    },
  })
}
