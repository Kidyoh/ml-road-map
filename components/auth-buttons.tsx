import { Button } from "@/components/ui/button";
import { signIn, signOut } from "@/lib/auth";

/**
 * Server actions rather than a client component: Auth.js v5 exposes signIn and
 * signOut as server-side calls, so a form post is the whole implementation.
 */

/**
 * Where a successful sign-in lands.
 *
 * M4 makes /map the default landing page for logged-in users. It does not exist
 * yet, and sending a freshly authenticated user to a 404 is a worse first
 * impression than any amount of missing functionality. Change this to "/map" in
 * M4 - it is the only place the destination is written down.
 */
const POST_SIGN_IN_REDIRECT = "/";

export function SignInButton({
  provider,
  children,
}: {
  provider: "github";
  children: React.ReactNode;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn(provider, { redirectTo: POST_SIGN_IN_REDIRECT });
      }}
    >
      <Button type="submit" variant="outline" className="w-full">
        {children}
      </Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
