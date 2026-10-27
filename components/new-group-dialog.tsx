"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"

import { createGroupChatAction } from "@/app/(app)/actions"
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { Bot } from "@/db/schema"
import { groupChatInsertSchema, type GroupChatInsert } from "@/db/validation"

// Open the "New group chat" dialog with `newGroupDialog.open(null)`.
// <NewGroupDialog /> must be mounted once (the app layout does this).
export const newGroupDialog = DialogPrimitive.createHandle()

export function NewGroupDialog({ bots }: { bots: Bot[] }) {
  return (
    <Dialog handle={newGroupDialog}>
      <DialogContent>
        <NewGroupForm bots={bots} />
      </DialogContent>
    </Dialog>
  )
}

// Lives inside the popup so the form resets every time the dialog closes.
function NewGroupForm({ bots }: { bots: Bot[] }) {
  const router = useRouter()
  const form = useForm<GroupChatInsert>({
    resolver: zodResolver(groupChatInsertSchema),
    defaultValues: { name: "", botIds: [] },
  })
  const { isSubmitting, errors } = form.formState

  async function onSubmit(values: GroupChatInsert) {
    const result = await createGroupChatAction(values)
    if ("error" in result) {
      form.setError("root", { message: result.error })
      return
    }
    newGroupDialog.close()
    router.push(`/group/${result.chatId}`)
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
    >
      <DialogHeader>
        <DialogTitle>New group chat</DialogTitle>
        <DialogDescription>
          Name the group and pick which bots are in it.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="group-name">Name</FieldLabel>
              <Input
                {...field}
                id="group-name"
                placeholder="Weekend plans"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="botIds"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">Bots</FieldLegend>
              {bots.length < 2 && (
                <FieldDescription>
                  A group needs at least two bots. Create some first.
                </FieldDescription>
              )}
              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
                {bots.map((bot) => (
                  <Field
                    key={bot.id}
                    orientation="horizontal"
                    data-invalid={fieldState.invalid}
                  >
                    <Checkbox
                      id={`group-bot-${bot.id}`}
                      checked={field.value.includes(bot.id)}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked
                            ? field.value.includes(bot.id)
                              ? field.value
                              : [...field.value, bot.id]
                            : field.value.filter((id) => id !== bot.id)
                        )
                      }
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldLabel
                      htmlFor={`group-bot-${bot.id}`}
                      className="font-normal"
                    >
                      <BotFace seed={bot.avatar} className="size-6" />
                      {bot.name}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </FieldSet>
          )}
        />

        {errors.root && <FieldError errors={[errors.root]} />}
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Create group
        </Button>
      </DialogFooter>
    </form>
  )
}
