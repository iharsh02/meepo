"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { BotFace } from "@/components/bot-face"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Bot } from "@/db/schema"

// Open the "New group chat" dialog with `newGroupDialog.open(null)`.
// <NewGroupDialog /> must be mounted once (the app layout does this).
export const newGroupDialog = DialogPrimitive.createHandle()

export function NewGroupDialog({ bots }: { bots: Bot[] }) {
  return (
    <Dialog handle={newGroupDialog}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            // TODO: persist the group once group chats exist in the schema.
            newGroupDialog.close()
          }}
        >
          <DialogHeader>
            <DialogTitle>New group chat</DialogTitle>
            <DialogDescription>
              Name the group and pick which bots are in it.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="group-name">Name</FieldLabel>
            <Input id="group-name" name="name" placeholder="Weekend plans" required />
          </Field>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2.5 font-medium">Bots</legend>
            {bots.length === 0 && (
              <p className="text-muted-foreground">No bots yet. Create one first.</p>
            )}
            {bots.map((bot) => (
              <Label key={bot.id} className="gap-2 font-normal">
                <Checkbox name="botIds" value={bot.id} />
                <BotFace seed={bot.faceSeed} className="size-6" />
                {bot.name}
              </Label>
            ))}
          </fieldset>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit">Create group</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
