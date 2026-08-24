import Link from "next/link";
import { notFound } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import {
  isAdminEmail,
  learners,
  nodeFunnel,
  phaseZeroFunnel,
  recentStruggles,
  struggleTotals,
} from "@/lib/admin";

export const metadata = { title: "Admin" };

const SIGNAL_UNIT: Record<string, string> = {
  time_to_first_check: "seconds",
  revealed_before_attempt: "questions",
  node_abandoned: "days",
  thin_reflection: "words",
  reopened_after_pass: "days",
};

function ago(then: Date | null): string {
  if (!then) return "never";
  return then.toISOString().slice(0, 16).replace("T", " ");
}

export default async function AdminPage() {
  const session = await auth();
  // 404 rather than 403: an unauthorised visitor learns nothing about whether
  // this route exists.
  if (!isAdminEmail(session?.user?.email)) notFound();

  const [funnel, people, struggles, totals, phase0] = await Promise.all([
    nodeFunnel(),
    learners(),
    recentStruggles(60),
    struggleTotals(),
    phaseZeroFunnel(),
  ]);

  const published = funnel.filter((n) => n.checklistTotal > 0);
  const maxOpened = Math.max(1, ...published.map((n) => n.opened));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            <Link href="/map" className="hover:text-foreground transition-colors">
              ML Roadmap
            </Link>
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Admin</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Signed in as {session?.user?.email}
          </p>
        </div>
        <ThemeToggle />
      </header>

      {/* --- the kill criterion, first ---------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-widest uppercase">
            Phase 0
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            The build plan&apos;s kill criterion: if nobody finishes phase 0, the
            problem is content or motivation, not features.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{phase0.learners}</p>
            <p className="text-muted-foreground text-xs">accounts</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {phase0.startedPhaseZero}
            </p>
            <p className="text-muted-foreground text-xs">opened a phase 0 node</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {phase0.finishedPhaseZero}
            </p>
            <p className="text-muted-foreground text-xs">
              finished all {phase0.phaseZeroNodes}
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {phase0.startedPhaseZero > 0
                ? `${Math.round((phase0.finishedPhaseZero / phase0.startedPhaseZero) * 100)}%`
                : "—"}
            </p>
            <p className="text-muted-foreground text-xs">of starters finished</p>
          </div>
        </CardContent>
      </Card>

      {/* --- learners ----------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-widest uppercase">
          Learners{" "}
          <span className="text-muted-foreground tabular-nums">
            ({people.length})
          </span>
        </h2>

        {people.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nobody has signed up yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Person", "Track", "Passed", "Opened", "Ticks", "Answers", "Reflections", "Signals", "Last active"].map(
                    (h) => (
                      <th
                        key={h}
                        className="border-b px-3 py-2 text-left font-medium whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="hover:bg-accent/40">
                    <td className="border-b px-3 py-2">
                      <Link
                        href={`/admin/learner/${p.id}`}
                        className="text-primary hover:underline"
                      >
                        {p.name ?? "(no name)"}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {p.email}
                      </span>
                    </td>
                    <td className="text-muted-foreground border-b px-3 py-2 text-xs">
                      {p.entryTrack ?? "not set"}
                    </td>
                    <td className="border-b px-3 py-2 tabular-nums">{p.nodesPassed}</td>
                    <td className="border-b px-3 py-2 tabular-nums">{p.nodesOpened}</td>
                    <td className="border-b px-3 py-2 tabular-nums">{p.ticks}</td>
                    <td className="border-b px-3 py-2 tabular-nums">{p.answers}</td>
                    <td className="border-b px-3 py-2 tabular-nums">{p.reflections}</td>
                    <td className="border-b px-3 py-2 tabular-nums">{p.struggles}</td>
                    <td className="text-muted-foreground border-b px-3 py-2 text-xs whitespace-nowrap">
                      {ago(p.lastActiveAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- where people stop -------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-widest uppercase">
          Where people stop
        </h2>
        <p className="text-muted-foreground text-sm">
          Opened against passed, per node, in roadmap order. A node where the two
          bars diverge is one people start and do not finish.
        </p>

        <div className="flex flex-col gap-1.5">
          {published.map((n) => (
            <div key={n.id} className="flex items-center gap-3 text-xs">
              <Link
                href={`/node/${n.slug}`}
                className="text-muted-foreground hover:text-foreground w-56 shrink-0 truncate"
                title={n.title}
              >
                <span className="font-mono">{n.id}</span> {n.title}
              </Link>
              <div className="bg-muted relative h-4 flex-1 overflow-hidden rounded">
                <span
                  className="bg-primary/30 absolute inset-y-0 left-0"
                  style={{ width: `${(n.opened / maxOpened) * 100}%` }}
                />
                <span
                  className="bg-primary absolute inset-y-0 left-0"
                  style={{ width: `${(n.passed / maxOpened) * 100}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right tabular-nums">
                {n.passed}/{n.opened}
              </span>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Solid = passed, faded = opened.
        </p>
      </section>

      {/* --- struggle signals --------------------------------------------- */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium tracking-widest uppercase">
            Signal totals
          </h2>
          {totals.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No struggle events recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="border-b px-3 py-2 text-left font-medium">Signal</th>
                    <th className="border-b px-3 py-2 text-left font-medium">Count</th>
                    <th className="border-b px-3 py-2 text-left font-medium">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => (
                    <tr key={t.signal}>
                      <td className="border-b px-3 py-2 font-mono text-xs">
                        {t.signal}
                      </td>
                      <td className="border-b px-3 py-2 tabular-nums">{t.count}</td>
                      <td className="text-muted-foreground border-b px-3 py-2 tabular-nums">
                        {t.avgValue === null
                          ? "—"
                          : `${Math.round(Number(t.avgValue) * 10) / 10} ${SIGNAL_UNIT[t.signal] ?? ""}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            <code className="bg-muted rounded px-1 py-0.5">node_abandoned</code> is
            defined but never emitted &mdash; it needs a scheduled job and there
            is not one yet.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium tracking-widest uppercase">
            Recent signals
          </h2>
          {struggles.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing yet.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <tbody>
                  {struggles.map((s) => (
                    <tr key={s.id} className="hover:bg-accent/40">
                      <td className="border-b px-3 py-2">
                        <Link
                          href={`/admin/learner/${s.userId}`}
                          className="text-primary text-xs hover:underline"
                        >
                          {s.userName ?? "someone"}
                        </Link>
                      </td>
                      <td className="border-b px-3 py-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {s.signal}
                        </Badge>
                      </td>
                      <td className="border-b px-3 py-2 font-mono text-xs">
                        {s.nodeId}
                      </td>
                      <td className="border-b px-3 py-2 text-xs tabular-nums">
                        {s.value === null
                          ? ""
                          : `${s.value} ${SIGNAL_UNIT[s.signal] ?? ""}`}
                      </td>
                      <td className="text-muted-foreground border-b px-3 py-2 text-xs whitespace-nowrap">
                        {ago(s.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
