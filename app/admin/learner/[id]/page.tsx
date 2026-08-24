import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { isAdminEmail, learnerDetail } from "@/lib/admin";

export const metadata = { title: "Learner" };

function stamp(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "—";
}

export default async function LearnerPage({
  params,
}: PageProps<"/admin/learner/[id]">) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) notFound();

  const { id } = await params;
  const detail = await learnerDetail(id);
  if (!detail) notFound();

  const { user, progress, ticks, answers, written, struggles } = detail;

  const ticksByNode = new Map<string, typeof ticks>();
  for (const t of ticks) {
    const list = ticksByNode.get(t.nodeId) ?? [];
    list.push(t);
    ticksByNode.set(t.nodeId, list);
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
          <Link href="/admin" className="hover:text-foreground transition-colors">
            Admin
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {user.name ?? "(no name)"}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {user.email} &middot; entry track {user.entryTrack ?? "not set"} &middot;
          joined {stamp(user.createdAt)}
        </p>
      </header>

      {/* --- progress ---------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-widest uppercase">
          Nodes touched{" "}
          <span className="text-muted-foreground tabular-nums">
            ({progress.length})
          </span>
        </h2>
        {progress.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing opened yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Node", "State", "Ticks", "Opened", "Last open", "Completed", "Visits"].map(
                    (h) => (
                      <th key={h} className="border-b px-3 py-2 text-left font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {progress.map((p) => {
                  const nodeTicks = ticksByNode.get(p.nodeId) ?? [];
                  const checked = nodeTicks.filter((t) => t.checked).length;
                  return (
                    <tr key={p.nodeId} className="hover:bg-accent/40">
                      <td className="border-b px-3 py-2">
                        <Link
                          href={`/node/${p.slug}`}
                          className="text-primary hover:underline"
                        >
                          <span className="font-mono text-xs">{p.nodeId}</span>{" "}
                          {p.title}
                        </Link>
                      </td>
                      <td className="border-b px-3 py-2">
                        <Badge
                          variant={p.completedAt ? "default" : "outline"}
                          className="text-[10px] font-normal"
                        >
                          {p.state}
                        </Badge>
                      </td>
                      <td className="border-b px-3 py-2 text-xs tabular-nums">
                        {checked}/{nodeTicks.length}
                      </td>
                      <td className="text-muted-foreground border-b px-3 py-2 text-xs whitespace-nowrap">
                        {stamp(p.openedAt)}
                      </td>
                      <td className="text-muted-foreground border-b px-3 py-2 text-xs whitespace-nowrap">
                        {stamp(p.lastOpenedAt)}
                      </td>
                      <td className="text-muted-foreground border-b px-3 py-2 text-xs whitespace-nowrap">
                        {stamp(p.completedAt)}
                      </td>
                      <td className="border-b px-3 py-2 text-xs tabular-nums">
                        {p.attemptCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- signals ------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-widest uppercase">
          Struggle signals{" "}
          <span className="text-muted-foreground tabular-nums">
            ({struggles.length})
          </span>
        </h2>
        {struggles.length === 0 ? (
          <p className="text-muted-foreground text-sm">None recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {struggles.map((s, i) => (
              <Badge key={i} variant="outline" className="font-mono text-[10px]">
                {s.nodeId} · {s.signal}
                {s.value !== null ? ` · ${s.value}` : ""}
              </Badge>
            ))}
          </div>
        )}
      </section>

      {/* --- what they wrote ---------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium tracking-widest uppercase">
            Answers{" "}
            <span className="text-muted-foreground tabular-nums">
              ({answers.length})
            </span>
          </h2>
        </div>
        <p className="text-muted-foreground max-w-prose text-xs">
          These are private to the learner in the product. They are shown here
          because the admin scope was set to include them &mdash; the reflection
          box still tells learners a reflection is shared only when they opt in,
          which is worth reconciling.
        </p>
        {answers.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing written yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {answers.map((a, i) => (
              <Card key={i}>
                <CardHeader>
                  <CardTitle className="text-sm leading-relaxed font-medium">
                    <span className="text-muted-foreground font-mono text-xs">
                      {a.nodeId}
                    </span>{" "}
                    {a.prompt}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {a.response?.trim() ? (
                      a.response
                    ) : (
                      <span className="text-muted-foreground italic">
                        Nothing written — answer key was revealed with an empty box.
                      </span>
                    )}
                  </p>
                  <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
                    <span>
                      self-rated: {a.selfRating ?? "not rated"}
                    </span>
                    <span>revealed: {stamp(a.revealedAt)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-widest uppercase">
          Reflections{" "}
          <span className="text-muted-foreground tabular-nums">
            ({written.length})
          </span>
        </h2>
        {written.length === 0 ? (
          <p className="text-muted-foreground text-sm">None written.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {written.map((r, i) => (
              <figure key={i} className="bg-muted/30 rounded-md border p-4">
                <blockquote className="text-sm leading-relaxed whitespace-pre-wrap">
                  {r.body}
                </blockquote>
                <figcaption className="text-muted-foreground mt-3 flex flex-wrap gap-3 text-xs">
                  <span className="font-mono">{r.nodeId}</span>
                  <span>{r.isPublic ? "shared publicly" : "private"}</span>
                  <span>{stamp(r.createdAt)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
