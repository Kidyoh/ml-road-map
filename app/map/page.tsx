import Link from "next/link";
import { redirect } from "next/navigation";

import { setEntryTrack } from "@/app/actions/progress";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { GuestSignInForm } from "@/components/guest-sign-in-form";
import { EntryTrackPicker } from "@/components/graph/entry-track-picker";
import { NodeTile } from "@/components/graph/node-tile";
import { PhaseRing } from "@/components/graph/phase-ring";
import { StartHere } from "@/components/graph/start-here";
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
import { loadNodeBySlug } from "@/lib/content";
import { isPublished } from "@/lib/content-schema";
import { buildGraph, summarisePhases, type EntryTrack } from "@/lib/progress";

export const metadata = {
  title: "Map",
  description: "The whole roadmap: 40 nodes across 8 phases.",
};

export default async function MapPage() {
  const session = await auth();
  const user = session?.user ?? null;

  // Signed out, the map is still worth seeing - it is the clearest statement of
  // what this thing is. Everything derives as if nothing has been passed.
  const graph = await buildGraph(user?.id ?? null, user?.entryTrack ?? null);
  const phases = summarisePhases(graph);

  const totalPassed = graph.nodes.filter((n) => n.state === "passed").length;
  const totalPublished = graph.nodes.filter((n) => n.status === "published").length;
  const resume = graph.resumeNodeId ? graph.byId.get(graph.resumeNodeId) : null;
  const nextOpen = graph.nodes.find(
    (n) => n.state === "open" && n.status === "published",
  );

  const needsTrack = Boolean(user) && !user?.entryTrack;

  // The card needs the session brief and difficulty, which live in the MDX
  // rather than the database. One filesystem read for one node.
  const next = resume ?? nextOpen ?? null;
  const nextContent = next ? await loadNodeBySlug(next.slug) : null;
  const nextBrief =
    nextContent && isPublished(nextContent.frontmatter)
      ? nextContent.frontmatter.session.brief
      : null;
  const nextDifficulty =
    nextContent && isPublished(nextContent.frontmatter)
      ? nextContent.frontmatter.session.difficulty
      : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            <Link href="/" className="hover:text-foreground transition-colors">
              ML Roadmap
            </Link>
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">The map</h1>
          <p className="text-muted-foreground mt-2 max-w-prose text-sm leading-relaxed">
            Forty nodes, eight phases.
            {user ? ` You have passed ${totalPassed} of ${totalPublished}.` : ""}{" "}
            Locked nodes are dimmed rather than hidden &mdash; you should be able
            to see the shape of the road ahead.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              <Avatar className="size-8">
                <AvatarImage src={user.image ?? undefined} alt={user.name ?? "You"} />
                <AvatarFallback>
                  {(user.name ?? "?").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Button asChild variant="ghost" size="sm">
                <Link href="/profile">Progress</Link>
              </Button>
              <SignOutButton />
            </>
          ) : null}
        </div>
      </header>

      {!user ? (
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Sign in to track progress</CardTitle>
            <CardDescription>
              The map is readable signed out. Ticks and unlocks need an account.
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
      ) : null}

      {needsTrack ? (
        <EntryTrackPicker
          onPick={async (track: EntryTrack) => {
            "use server";
            await setEntryTrack(track);
            redirect("/map");
          }}
        />
      ) : null}

      {user && !needsTrack && next ? (
        <StartHere
          node={next}
          brief={nextBrief}
          difficulty={nextDifficulty}
          resuming={Boolean(resume)}
        />
      ) : null}

      <div className="flex flex-col gap-10">
        {phases.map((phase) => {
          const phaseNodes = graph.nodes.filter((n) => n.phase === phase.phase);
          return (
            <section key={phase.phase} className="flex flex-col gap-4">
              <div className="flex items-center gap-4 border-t pt-4">
                <PhaseRing passed={phase.passed} total={phase.total} />
                <div className="min-w-0">
                  <h2 className="font-semibold tracking-tight">
                    <span className="text-muted-foreground font-mono text-sm">
                      {String(phase.phase).padStart(2, "0")}
                    </span>{" "}
                    {phase.name}
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    {phase.published} of {phase.total} written
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {phaseNodes.map((node) => (
                  <NodeTile key={node.id} node={node} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="text-muted-foreground border-t pt-6 text-xs leading-relaxed">
        <p>
          A node passes when every checklist item is ticked and every question is
          self-rated. Every checkpoint item is something you can be honestly
          wrong about &mdash; that is what makes ticking one mean anything.
        </p>
      </footer>
    </main>
  );
}
