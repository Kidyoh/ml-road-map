import Link from "next/link";
import { Lock } from "lucide-react";

import { ResourceCards } from "@/components/node/resource-cards";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Resource } from "@/lib/content-schema";
import type { NodeSummary } from "@/lib/progress";

/**
 * A published node whose prerequisites are not passed yet.
 *
 * The build plan fogs locked nodes rather than hiding them so the learner can
 * "see the shape of the road ahead" - but seeing the shape is not the same as
 * reading the content. What is withheld and why:
 *
 *   answer keys   non-negotiable 4 wants recall and articulation. Reading the
 *                 key before ever attempting the question destroys the only
 *                 thing the reveal fold is for.
 *   checklist     section 8 names self-verification inflation as a live risk.
 *                 Studying the checkpoint for a node you have not earned makes
 *                 it materially easier to tick boxes you did not earn.
 *   body + brief  they give away the session's planted surprises. Node 2.3 is
 *                 worthless to someone who already knows there are exactly
 *                 three leaks and where.
 *
 * Resources are deliberately NOT withheld. They are public links to other
 * people's work; hoarding them would be pointless and slightly absurd. Someone
 * who wants to read ahead about attention should go and read about attention.
 *
 * This component only renders what the page passes it. The page never loads the
 * checklist, questions or MDX body for a locked node in the first place - so
 * none of it reaches the browser, and the lock survives devtools.
 */
export function LockedNode({
  resources,
  difficulty,
  blockers,
  signedIn,
}: {
  resources: { primary: Resource; alt: Resource };
  difficulty: string;
  blockers: NodeSummary[];
  signedIn: boolean;
}) {
  return (
    <>
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-widest uppercase">
            <Lock className="size-4" aria-hidden />
            Locked
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm leading-relaxed">
          <p className="max-w-prose">
            The session, checkpoint and questions for this node open up once its
            prerequisites are passed. The goal above and the resources below are
            visible now, so you can see where this is going.
          </p>

          {blockers.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs tracking-widest uppercase">
                Pass these first
              </p>
              <ul className="flex flex-col gap-2">
                {blockers.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {b.id}
                    </Badge>
                    <Link
                      href={`/node/${b.slug}`}
                      className="text-primary hover:underline"
                    >
                      {b.title}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      {b.status === "planned"
                        ? "not written yet"
                        : b.state === "passed"
                          ? "passed"
                          : b.state.replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!signedIn ? (
            <p className="text-muted-foreground max-w-prose">
              You are signed out, so nothing counts as passed yet. Sign in and
              work forward from node 0.1.
            </p>
          ) : null}

          <p className="text-muted-foreground max-w-prose text-xs">
            This is a difficulty-{difficulty} node.
          </p>
        </CardContent>
      </Card>

      <ResourceCards primary={resources.primary} alt={resources.alt} />
    </>
  );
}
