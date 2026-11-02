"use client";

import { useActionState } from "react";

import { guestSignIn, type GuestSignInState } from "@/app/actions/guest";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const INPUT_CLASS =
  "border-input bg-background focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]";

const INITIAL: GuestSignInState = { error: null };

/** Email + password form for the shared guest pass. See lib/auth.ts. */
export function GuestSignInForm() {
  const [state, action, pending] = useActionState(guestSignIn, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="guest-username">Username</Label>
        <input
          id="guest-username"
          name="username"
          type="text"
          placeholder="guest@roadmap"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className={INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="guest-password">Password</Label>
        <input
          id="guest-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={INPUT_CLASS}
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in..." : "Sign in with guest pass"}
      </Button>
    </form>
  );
}
