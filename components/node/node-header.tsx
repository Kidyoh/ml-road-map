import { Badge } from "@/components/ui/badge";

export function NodeHeader({
  id,
  phase,
  title,
  goal,
}: {
  id: string;
  phase: number;
  title: string;
  goal: string;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono">
          {id}
        </Badge>
        <span className="text-muted-foreground text-xs tracking-widest uppercase">
          Phase {phase}
        </span>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h1>

      {/*
        The goal is a capability, not a topic. It gets its own visual weight
        because it is the only thing on the page that says what "done" means.
      */}
      <p className="border-primary/40 max-w-prose border-l-2 pl-4 text-lg leading-relaxed text-pretty">
        {goal}
      </p>
    </header>
  );
}
