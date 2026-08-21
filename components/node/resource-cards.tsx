import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Resource } from "@/lib/content-schema";

/**
 * Both resources always render. `alt` is required in the schema because link rot
 * is a named risk and an optional fallback is not a fallback - if the primary
 * dies, the learner needs somewhere to go that is already on the page.
 *
 * Cost is shown on the card rather than behind a click, so a paid resource is
 * never a surprise after someone has followed the link.
 */
function ResourceCard({
  resource,
  label,
}: {
  resource: Resource;
  label: string;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs tracking-widest uppercase">
            {label}
          </span>
          <div className="flex gap-1.5">
            <Badge variant="secondary" className="text-xs font-normal">
              {resource.type}
            </Badge>
            <Badge
              variant={resource.cost === "paid" ? "default" : "outline"}
              className="text-xs font-normal"
            >
              {resource.cost}
            </Badge>
          </div>
        </div>
        <CardTitle className="text-base leading-snug font-medium text-pretty">
          {resource.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="mt-auto">
        <a
          href={resource.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
        >
          Open
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </CardContent>
    </Card>
  );
}

export function ResourceCards({
  primary,
  alt,
}: {
  primary: Resource;
  alt: Resource;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium tracking-widest uppercase">Resources</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <ResourceCard resource={primary} label="Primary" />
        <ResourceCard resource={alt} label="Alternate" />
      </div>
      <p className="text-muted-foreground text-xs">
        Pick one. They cover the same ground &mdash; the alternate exists so a
        dead link or a paywall never blocks you.
      </p>
    </section>
  );
}
