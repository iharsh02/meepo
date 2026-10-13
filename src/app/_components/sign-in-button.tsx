"use client";

import { authClient } from "@/server/better-auth/client";

export function SignInButton() {
  return (
    <button
      className="rounded-full bg-white/10 px-10 py-3 font-semibold no-underline transition hover:bg-white/20"
      onClick={() => {
        void authClient.signIn.social({
          provider: "github",
          callbackURL: "/",
        });
      }}
      type="button"
    >
      Sign in with GitHub
    </button>
  );
}
