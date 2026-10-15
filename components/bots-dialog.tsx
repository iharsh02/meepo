"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, ShuffleIcon } from "lucide-react"
import { nanoid } from "nanoid"
import { useRouter } from "next/navigation"
import { Controller, useForm, useWatch } from "react-hook-form"

import { createBotAction } from "@/app/(app)/actions"
import { BotFace } from "@/components/bot-face"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { botInsertSchema, type BotInsert } from "@/db/validation"

// Open the New bot dialog from anywhere with `botsDialog.open(null)`, or with
// <CreateBotButton />. <BotsDialog /> must be mounted once (the app layout does this).
export const botsDialog = DialogPrimitive.createHandle()

const presets = [
  {
    job: "Research assistant",
    instructions:
      "Answer briefly, cite sources, and ask before running anything destructive.",
  },
  {
    job: "Code reviewer",
    instructions:
      "Read the diff carefully, flag bugs before style, and suggest concrete fixes.",
  },
  {
    job: "Writing editor",
    instructions:
      "Tighten my prose, keep my voice, and explain every change you make.",
  },
  {
    job: "Tutor",
    instructions:
      "Explain step by step, check my understanding, and don't just hand me the answer.",
  },
]

export function BotsDialog() {
  return (
    <Dialog handle={botsDialog}>
      <DialogContent className="sm:max-w-lg">
        <NewBotForm />
      </DialogContent>
    </Dialog>
  )
}

// Server components can't pass the handle, so they render this button instead.
export function CreateBotButton() {
  return (
    <DialogTrigger handle={botsDialog} render={<Button variant="secondary" />}>
      <PlusIcon data-icon="inline-start" />
      Create a new bot
    </DialogTrigger>
  )
}

// Lives inside the popup so the form resets every time the dialog closes.
function NewBotForm() {
  const router = useRouter()
  const form = useForm<BotInsert>({
    resolver: zodResolver(botInsertSchema),
    defaultValues: {
      name: "",
      job: "",
      instructions: "",
      avatar: nanoid(),
    },
  })
  const avatar = useWatch({ control: form.control, name: "avatar" })
  const { isSubmitting, errors } = form.formState

  async function onSubmit(values: BotInsert) {
    const result = await createBotAction(values)
    if ("error" in result) {
      form.setError("root", { message: result.error })
      return
    }
    botsDialog.close()
    router.push(`/chat/${result.botId}`)
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogHeader>
        <DialogTitle>New bot</DialogTitle>
        <DialogDescription>Give it a face, a name, and a job to do.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.job}
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => {
              form.setValue("job", preset.job, { shouldDirty: true, shouldValidate: true })
              form.setValue("instructions", preset.instructions, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }}
          >
            {preset.job}
          </Button>
        ))}
      </div>

      <FieldGroup>
        <Field orientation="horizontal" className="items-start">
          <BotFace seed={avatar} className="size-14" />
          <FieldContent>
            <FieldTitle>Face</FieldTitle>
            <FieldDescription>Shuffle until you find one you like.</FieldDescription>
          </FieldContent>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => form.setValue("avatar", nanoid())}
          >
            <ShuffleIcon data-icon="inline-start" />
            Shuffle
          </Button>
        </Field>

        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-name">Name</FieldLabel>
              <Input
                {...field}
                id="bot-name"
                placeholder="Ada"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="job"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-job">Job</FieldLabel>
              <Input
                {...field}
                id="bot-job"
                placeholder="Research assistant"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="instructions"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-instructions">How it should work</FieldLabel>
              <Textarea
                {...field}
                value={field.value ?? ""}
                id="bot-instructions"
                placeholder="Answer briefly, cite sources, and ask before running anything destructive."
                className="min-h-24 resize-none"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        {errors.root && <FieldError errors={[errors.root]} />}
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Create bot
        </Button>
      </DialogFooter>
    </form>
  )
}
