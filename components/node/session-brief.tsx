import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublishedNode } from "@/lib/content-schema";

const DIFFICULTY_COPY: Record<PublishedNode["session"]["difficulty"], string> = {
  easy: "Expect an hour or two.",
  medium: "Expect an afternoon.",
  hard: "Expect a day, and expect to be wrong first.",
};

export function SessionBrief({
  session,
}: {
  session: PublishedNode["session"];
}) {
  const isLocalDataset = session.dataset?.startsWith("/datasets/");
  const fileName = session.dataset?.split("/").pop();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium tracking-widest uppercase">
            The session
          </CardTitle>
          <Badge variant="outline" className="text-xs font-normal">
            {session.difficulty}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="max-w-prose leading-relaxed text-pretty">{session.brief}</p>

        <p className="text-muted-foreground text-xs">
          {DIFFICULTY_COPY[session.difficulty]}
        </p>

        {session.dataset ? (
          <a
            href={session.dataset}
            download={isLocalDataset ? fileName : undefined}
            target={isLocalDataset ? undefined : "_blank"}
            rel="noreferrer noopener"
            className="border-input hover:bg-accent inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 font-mono text-sm transition-colors"
          >
            <Download className="size-4" aria-hidden />
            {fileName ?? "Dataset"}
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}
