import Link from "next/link";

import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { GuestSignInForm } from "@/components/guest-sign-in-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth, guestPassEnabled } from "@/lib/auth";

const PHASES = [
  { n: 0, name: "Tooling floor", count: 5 },
  { n: 1, name: "Math on demand", count: 5 },
  { n: 2, name: "Supervised learning", count: 7 },
  { n: 3, name: "Unsupervised and feature work", count: 5 },
  { n: 4, name: "Deep learning", count: 6 },
  { n: 5, name: "Applied LLM", count: 5 },
  { n: 6, name: "Ship it", count: 6 },
  { n: 7, name: "Capstone", count: 1 },
];

export default async function LandingPage() {
  const session = await auth();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            ML Roadmap
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Zero to a deployed system, one falsifiable checkpoint at a time.
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {session?.user ? (
            <>
              <Avatar className="size-8">
                <AvatarImage
                  src={session.user.image ?? undefined}
                  alt={session.user.name ?? "You"}
                />
                <AvatarFallback>
                  {(session.user.name ?? "?").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <SignOutButton />
            </>
          ) : null}
        </div>
      </header>

      <p className="text-muted-foreground max-w-prose leading-relaxed">
        Forty nodes across eight phases. Each one gives you a goal, two
        resources, a coding session, and a checklist you can genuinely fail.
        Nodes unlock when their prerequisites are passed &mdash; locked ones stay
        visible, so you can always see the shape of the road ahead.
      </p>

      {session?.user ? (
        <Card>
          <CardHeader>
            <CardTitle>Signed in as {session.user.name ?? session.user.email}</CardTitle>
            <CardDescription>
              {session.user.entryTrack
                ? `Entry track: ${session.user.entryTrack}`
                : "You have not picked an entry track yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/map">Go to the map</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/profile">Your progress</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Sign in to start</CardTitle>
            <CardDescription>
              Progress is tied to an account. Connect GitHub, or use the
              guest pass if you have one.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <SignInButton provider="github">Continue with GitHub</SignInButton>
            {guestPassEnabled() ? (
              <>
                <p className="text-muted-foreground my-2 text-center text-xs">
                  or use the guest pass
                </p>
                <GuestSignInForm />
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      <section className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {PHASES.map((phase) => (
          <div
            key={phase.n}
            className="flex items-baseline gap-3 border-t pt-3 text-sm"
          >
            <span className="text-muted-foreground font-mono text-xs">
              {String(phase.n).padStart(2, "0")}
            </span>
            <span className="flex-1 font-medium">{phase.name}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {phase.count} {phase.count === 1 ? "node" : "nodes"}
            </span>
          </div>
        ))}
      </section>

      <p className="text-muted-foreground border-t pt-6 text-xs">
        All forty nodes are written. Nothing here has been through a pilot yet,
        so expect rough edges &mdash; and if a checklist item is wrong, that is
        a bug worth reporting.
      </p>
    </main>
  );
}
