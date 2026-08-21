import Link from "next/link";

import type { NodeSummary, PhaseSummary } from "@/lib/progress";

/**
 * Per-phase completion, as stacked bars.
 *
 * Three states per phase - passed, started, untouched - because "started" is the
 * information a plain completion percentage throws away, and it is usually what
 * a learner wants to see when deciding where to go back to.
 */
export function PhaseBreakdown({
  phases,
  nodes,
}: {
  phases: PhaseSummary[];
  nodes: NodeSummary[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {phases.map((phase) => {
        const inPhase = nodes.filter((n) => n.phase === phase.phase);
        const passed = inPhase.filter((n) => n.state === "passed").length;
        const started = inPhase.filter((n) => n.state === "in_progress").length;
        const untouched = inPhase.length - passed - started;
        const pct = (n: number) => (n / inPhase.length) * 100;

        const resumeHere = inPhase.find((n) => n.state === "in_progress");

        return (
          <div key={phase.phase} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>
                <span className="text-muted-foreground font-mono text-xs">
                  {String(phase.phase).padStart(2, "0")}
                </span>{" "}
                {phase.name}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {passed}/{inPhase.length}
              </span>
            </div>

            <div
              className="bg-muted flex h-2 w-full overflow-hidden rounded-full"
              role="img"
              aria-label={`Phase ${phase.phase}: ${passed} passed, ${started} in progress, ${untouched} not started`}
            >
              {passed > 0 ? (
                <span className="bg-primary block h-full" style={{ width: `${pct(passed)}%` }} />
              ) : null}
              {started > 0 ? (
                <span
                  className="bg-primary/40 block h-full"
                  style={{ width: `${pct(started)}%` }}
                />
              ) : null}
            </div>

            {resumeHere ? (
              <Link
                href={`/node/${resumeHere.slug}`}
                className="text-muted-foreground hover:text-foreground w-fit text-xs transition-colors"
              >
                in progress: {resumeHere.id} {resumeHere.title}
              </Link>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
