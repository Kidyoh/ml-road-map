import type { PassedPoint } from "@/lib/activity";

/**
 * Cumulative nodes passed over time, as a step chart.
 *
 * A step rather than a smooth line because passing a node is a discrete event -
 * interpolating between two passes would draw progress on days when nothing
 * happened, which is exactly the kind of small dishonesty this roadmap keeps
 * arguing against.
 *
 * There is no projected trend line and no target. The chart says what happened.
 */
export function PassedOverTime({
  points,
  total,
  asOf,
}: {
  points: PassedPoint[];
  total: number;
  /** Today, as YYYY-MM-DD. Passed in rather than read during render, because a
   *  component that calls Date.now() is not a pure function of its props. */
  asOf: string;
}) {
  if (points.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No nodes passed yet. The chart appears once you pass your first.
      </p>
    );
  }

  const width = 640;
  const height = 180;
  const padding = { top: 12, right: 16, bottom: 24, left: 32 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const times = points.map((p) => Date.parse(p.date));
  const minT = Math.min(...times);
  // Always extend to today, so a long gap since the last pass is visible rather
  // than hidden by the axis ending at the last event.
  const maxT = Math.max(Date.parse(asOf), ...times);
  const span = Math.max(maxT - minT, 86_400_000);

  const x = (t: number) => padding.left + ((t - minT) / span) * plotW;
  const y = (v: number) => padding.top + plotH - (v / Math.max(total, 1)) * plotH;

  // Step path: horizontal to the next date, then vertical to the new count.
  const segments: string[] = [`M ${x(times[0])} ${y(0)}`];
  points.forEach((point, i) => {
    const px = x(times[i]);
    segments.push(`L ${px} ${y(point.cumulative)}`);
    const nextT = i + 1 < times.length ? times[i + 1] : maxT;
    segments.push(`L ${x(nextT)} ${y(point.cumulative)}`);
  });

  const gridValues = [0, Math.round(total / 2), total].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Cumulative nodes passed, reaching ${points[points.length - 1].cumulative} of ${total}`}
        className="min-w-full"
      >
        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={padding.left - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[9px] tabular-nums"
            >
              {v}
            </text>
          </g>
        ))}

        <path
          d={segments.join(" ")}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {points.map((point, i) => (
          <circle
            key={point.date}
            cx={x(times[i])}
            cy={y(point.cumulative)}
            r={2.5}
            className="fill-primary"
          >
            {/* One text child, not several. Multiple children in an SVG
                <title> hydrate inconsistently and React reports a mismatch. */}
            <title>{`${point.date}: ${point.cumulative} of ${total} passed`}</title>
          </circle>
        ))}

        <text
          x={padding.left}
          y={height - 6}
          className="fill-muted-foreground text-[9px]"
        >
          {points[0].date}
        </text>
        <text
          x={width - padding.right}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[9px]"
        >
          today
        </text>
      </svg>
    </div>
  );
}
