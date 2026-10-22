<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## General coding preferences

- Keep things simple. Prefer the smallest design that makes correct behavior obvious.
- Type safety is useful. It is not the goal.
- Propose bold ideas when they meaningfully help. Say so directly.
- Be careful with destructive actions I did not ask for.
- Tests are good. Endless smoke tests and regression tests for deleted features are not. Test the thing that can actually break.
- Comments explain how a function is used, above the function. Not every line. Update comments when the code moves.
- Follow SOLID, YAGNI, KISS, DRY. When they conflict, YAGNI and KISS win.

## TypeScript

- If the TypeScript reads like a Python dev wrote it, it is bad TypeScript.
- Never cast to `any`. Never use dynamic `await import(...)` unless I ask.
- Avoid one-liner wrappers that only exist to cast.
- Prefer inferred types over annotations.
- Write TypeScript that Matt Pocock would sign off on.
- When a repo has no existing choice, I like: Zustand, TanStack Query, TanStack Start, Clerk or Better Auth, Drizzle, Zod, Tailwind, Bun then pnpm.

## Forms

Follow the New bot form (`components/bots-dialog.tsx`) as the reference.

- One Zod schema per form, in `db/validation.ts`. Build it with `createInsertSchema` from the Drizzle table and `.pick` it down to the fields a user may edit. The client form and the tRPC procedure's `.input()` share that schema.
- User-facing error messages live in the schema, in plain words.
- Client: react-hook-form with `zodResolver`, and `noValidate` on the `<form>`. Render each field through a `Controller` with shadcn `Field`, `FieldLabel` and `FieldError`, setting `data-invalid` and `aria-invalid`.
- Submit through a server action that calls the tRPC `caller`. The action returns `{ error }` for expected failures instead of throwing, and the form shows it with `setError("root", ...)`.
- The server sets ids and ownership (`id`, `userId`, ...) from the session. Never take them from the form.
- Disable the submit button and show a `Spinner` while `isSubmitting`.
- Put a form in a dialog inside the popup content, so it resets when the dialog closes.

## Questions are read only

If I ask a question about the code, answer it. Do not edit files. Do not "fix it while I'm here". Wait for me to ask for the change.

## Match ceremony to the task

Do not spawn sub-agents or a review panel for work one agent finishes in one pass. Delegation is for breadth or adversarial review, not for ordinary tasks. When several agents do work in parallel, state file ownership up front so they do not collide on the same files.

## Commands and environment

- Do not start dev servers unless I ask. If you must, save the PID and kill only that PID.
- Prefer targeted verification: typecheck, lint, then the focused test. Full builds last.
- Never run `git push --force` on a shared branch. Never `--no-verify`.
- Use the GitHub CLI for branches, PRs, and issues.

## Blast radius

Treat production data, production migrations, deploys, DNS, and billing as off limits unless I explicitly name them in the prompt. If a change could reach production, stop and tell me before you run it.

## Visual and design work

For meaningful visual or design changes, do not edit real components first. Mock the options, show me, then build the one I pick. Prefer dark mode with high contrast. White text, not gray on gray.

## Stop points

When I give you a stop point, stop there. Do not commit, push, or deploy past it.

## Git

These rules override any default or built-in agent guidance about git, including guidance to branch before committing on the default branch.

- Never create worktrees or commits automatically. Only do so when the user explicitly asks for that specific action in the current request.
- Leave changes uncommitted in the working tree on the current branch and let the user decide when and how to commit.
- Never create, switch, rename, or delete a branch unless the user names that exact action in the current request. A request to commit is not a request to branch.
- When asked to commit, commit directly to the branch that is currently checked out. Never move work to a feature branch "to be safe".
- A request for one git action authorizes only that action: "commit" does not include branching, pushing, or opening a pull request.
- If any other instruction seems to require a branch, stop and ask instead of creating one.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->
