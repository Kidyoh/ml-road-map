import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * What you see on a node nobody has written yet.
 *
 * It exists as a real page rather than a 404 because the roadmap is meant to let
 * you see the shape of the road ahead. Being honest that a node is unwritten is
 * better than pretending it is locked, and far better than a dead link.
 */
export function PlannedNode({
  id,
  goal,
  notes,
  prereqTitles,
}: {
  id: string;
  goal: string;
  notes?: string;
  prereqTitles: { id: string; title: string; slug: string; written: boolean }[];
}) {
  return (
    <>
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-widest uppercase">
            Not written yet
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm leading-relaxed">
          <p className="max-w-prose">
            Node {id} is planned but has no session, checklist or questions yet.
            Its place in the graph is real &mdash; what it teaches and what it
            depends on are settled &mdash; but the content is still to come.
          </p>
          <p className="text-muted-foreground max-w-prose">
            Because there is no checklist, this node cannot be passed, so nothing
            downstream of it will unlock. That is deliberate: the roadmap is
            genuinely incomplete and the map should not pretend otherwise.
          </p>
        </CardContent>
      </Card>

      {prereqTitles.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium tracking-widest uppercase">
            Depends on
          </h2>
          <ul className="flex flex-col gap-2">
            {prereqTitles.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-t pt-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {p.id}
                </Badge>
                {p.written ? (
                  <Link
                    href={`/node/${p.slug}`}
                    className="text-primary text-sm hover:underline"
                  >
                    {p.title}
                  </Link>
                ) : (
                  <span className="text-muted-foreground text-sm">{p.title}</span>
                )}
                {!p.written ? (
                  <span className="text-muted-foreground ml-auto text-xs">
                    also unwritten
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {notes ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium tracking-widest uppercase">
            Planning notes
          </h2>
          <p className="text-muted-foreground max-w-prose border-l-2 pl-4 text-sm leading-relaxed">
            {notes}
          </p>
          <p className="text-muted-foreground text-xs">
            Carried over from the build plan. These become the session brief and
            checklist when the node is written.
          </p>
        </section>
      ) : null}

      <p className="text-muted-foreground text-sm">
        Goal, once written: <span className="text-foreground">{goal}</span>
      </p>
    </>
  );
}
