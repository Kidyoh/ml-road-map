import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth-buttons";
import { claimCertificate } from "@/app/actions/exams";
import { ActivityHeatmap } from "@/components/profile/activity-heatmap";
import { ExamRecord } from "@/components/profile/exam-record";
import { PassedOverTime } from "@/components/profile/passed-over-time";
import { PhaseBreakdown } from "@/components/profile/phase-breakdown";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { buildActivity } from "@/lib/activity";
import {
  certificateStatus,
  loadCertificateForUser,
  MAX_CERTIFICATE_NAME,
} from "@/lib/exams";
import { buildGraph, summarisePhases } from "@/lib/progress";

export const metadata = {
  title: "Progress",
  description: "Your activity and progress through the roadmap.",
};

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/map");

  const user = session.user;

  const [graph, activity, certificate] = await Promise.all([
    buildGraph(user.id, user.entryTrack ?? null),
    buildActivity(user.id),
    loadCertificateForUser(user.id),
  ]);

  const examsPassed = graph.exams.filter((e) => e.state === "passed").length;
  const certStatus = certificateStatus(graph, user.id);

  const phases = summarisePhases(graph);
  const passed = graph.nodes.filter((n) => n.state === "passed");
  const earned = passed.filter((n) => !n.assumedPassed);
  const inProgress = graph.nodes.filter((n) => n.state === "in_progress");

  // Checklist items ticked across everything, which is a finer-grained measure
  // of work done than nodes passed - most of the effort is inside a node.
  const itemsDone = graph.nodes.reduce((sum, n) => sum + n.checklistDone, 0);
  const itemsTotal = graph.nodes.reduce((sum, n) => sum + n.checklistTotal, 0);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            <Link href="/map" className="hover:text-foreground transition-colors">
              Map
            </Link>
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {user.name ?? "Your progress"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {user.entryTrack
              ? `Entry track: ${user.entryTrack}`
              : "No entry track set"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Avatar className="size-8">
            <AvatarImage src={user.image ?? undefined} alt={user.name ?? "You"} />
            <AvatarFallback>
              {(user.name ?? "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <SignOutButton />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 border-y py-6 sm:grid-cols-5">
        <Stat value={`${earned.length}/40`} label="nodes passed" />
        <Stat value={`${itemsDone}/${itemsTotal}`} label="checkpoint items ticked" />
        <Stat value={activity.activeDays} label="days active" />
        <Stat value={inProgress.length} label="nodes in progress" />
        {graph.exams.length > 0 ? (
          <Stat value={`${examsPassed}/${graph.exams.length}`} label="exams passed" />
        ) : null}
      </section>

      {passed.length > earned.length ? (
        <p className="text-muted-foreground text-xs">
          {passed.length - earned.length} further node
          {passed.length - earned.length === 1 ? " is" : "s are"} counted as
          passed because your entry track assumes them. Those are not included in
          the figure above.
        </p>
      ) : null}

      {graph.exams.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium tracking-widest uppercase">
              Exams
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              One at the end of each phase, then the final. Passing one opens
              the phase after it.
            </p>
          </CardHeader>
          <CardContent>
            <ExamRecord exams={graph.exams} />
          </CardContent>
        </Card>
      ) : null}

      {graph.exams.length > 0 ? (
        <Card id="certificate" className={certificate ? "border-primary/50" : undefined}>
          <CardHeader>
            <CardTitle className="text-sm font-medium tracking-widest uppercase">
              Certificate
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
            {certificate ? (
              <>
                <p className="max-w-prose">
                  Issued to {certificate.name}. The link is public to anyone you
                  give it to, and shows your name, the date and your exam scores.
                </p>
                <Button asChild size="sm" className="w-fit">
                  <Link href={`/certificate/${certificate.id}`}>View certificate</Link>
                </Button>
              </>
            ) : certStatus.eligible ? (
              <form action={claimCertificate} className="flex flex-col gap-3">
                <p className="max-w-prose">
                  You have passed the final exam and the capstone. Choose the
                  name to print &mdash; it cannot be changed afterwards.
                </p>
                <label className="flex max-w-sm flex-col gap-1.5">
                  <span className="text-muted-foreground text-xs">Name on the certificate</span>
                  <input
                    name="name"
                    type="text"
                    required
                    maxLength={MAX_CERTIFICATE_NAME}
                    defaultValue={user.name ?? ""}
                    autoComplete="name"
                    className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3"
                  />
                </label>
                <Button type="submit" size="sm" className="w-fit">
                  Issue my certificate
                </Button>
              </form>
            ) : (
              <>
                <p className="text-muted-foreground max-w-prose">
                  Issued once the whole roadmap is done. Still to do:
                </p>
                <ul className="text-muted-foreground list-disc pl-5">
                  {certStatus.missing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-widest uppercase">
            Activity
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {activity.totalEvents === 0
              ? "Nothing recorded yet."
              : `${activity.totalEvents} recorded actions across ${activity.activeDays} days.`}
            {activity.eventsBeforeWindow > 0
              ? ` ${activity.eventsBeforeWindow} of them fall before this month and are not on the grid.`
              : ""}
          </p>
        </CardHeader>
        <CardContent>
          <ActivityHeatmap
            days={activity.days}
            busiestDay={activity.busiestDay}
            today={activity.today}
          />
          <p className="text-muted-foreground mt-4 max-w-prose text-xs leading-relaxed">
            The year ahead, from the start of this month. Filled cells are days
            you ticked something, answered something, or wrote a reflection;
            outlined cells have not happened yet. There is no streak here on
            purpose &mdash; a streak is a reason to tick a box you did not earn,
            and the checkpoints only work if they are honest.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-widest uppercase">
            Nodes passed over time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PassedOverTime
            points={activity.passedOverTime}
            total={graph.nodes.length}
            asOf={activity.today}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-widest uppercase">
            By phase
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PhaseBreakdown phases={phases} nodes={graph.nodes} />
        </CardContent>
      </Card>

      <footer className="text-muted-foreground border-t pt-6 text-xs">
        <Link href="/map" className="hover:text-foreground transition-colors">
          Back to the map
        </Link>
      </footer>
    </main>
  );
}
