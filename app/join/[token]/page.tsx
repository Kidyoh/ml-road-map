import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth, isValidGuestToken, signIn } from "@/lib/auth";
import { GUEST_DISPLAY_NAME } from "@/lib/guest";

/**
 * The shareable guest link: /join/<GUEST_LINK_TOKEN>.
 *
 * Opening the link does not sign anyone in by itself - it shows a button, and
 * the button signs in. Link previews (Slack, email scanners) fetch URLs with
 * GET, and a GET that creates sessions would hand one out to every unfurl.
 *
 * A wrong or disabled token is a plain 404, so the page does not confirm that
 * the route exists.
 */
export const metadata = {
  title: "Join",
  robots: { index: false, follow: false },
  // Keep the token out of the Referer header on any outbound link.
  referrer: "no-referrer",
};

export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  if (!isValidGuestToken(token)) notFound();

  const session = await auth();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <div>
        <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
          ML Roadmap
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Welcome, {GUEST_DISPLAY_NAME}
        </h1>
      </div>

      <Card className="max-w-sm">
        {session?.user ? (
          <>
            <CardHeader>
              <CardTitle>
                You are signed in as {session.user.name ?? session.user.email}
              </CardTitle>
              <CardDescription>
                Sign out first if you want to switch to the {GUEST_DISPLAY_NAME}{" "}
                account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/map">Go to the map</Link>
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Continue to the roadmap</CardTitle>
              <CardDescription>
                No account needed, and every node is open. Everyone using this
                link shares one {GUEST_DISPLAY_NAME} account and its progress.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={async () => {
                  "use server";
                  try {
                    await signIn("guest", { token, redirectTo: "/map" });
                  } catch (error) {
                    // Token rotated between page load and click.
                    if (error instanceof AuthError) redirect("/");
                    throw error;
                  }
                }}
              >
                <Button type="submit" className="w-full">
                  Continue as {GUEST_DISPLAY_NAME}
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
