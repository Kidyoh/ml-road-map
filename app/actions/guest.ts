"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";

export type GuestSignInState = { error: string | null };

/**
 * Guest pass sign-in. On success signIn throws Next's redirect, which must be
 * rethrown; only Auth.js errors (wrong username or password) become a message.
 */
export async function guestSignIn(
  _prev: GuestSignInState,
  formData: FormData,
): Promise<GuestSignInState> {
  try {
    await signIn("guest", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "That guest username and password did not match." };
    }
    throw error;
  }
  return { error: null };
}
