import type { ActivityDay } from "@/lib/activity";

/**
 * The year ahead, starting at the first of the current month.
 *
 * Descriptive, not motivational. There is no streak counter and no target,
 * because a streak is a direct incentive to tick a checklist item you did not
 * earn in order to keep a number alive - which section 8 names as a live risk.
 *
 * The one thing this layout has to get right: a day that has not happened yet
 * must not look like a day you skipped. Future cells are drawn as empty outlines
 * rather than filled squares, so the grid reads as "a year to fill in" instead
 * of "you missed three hundred days".
 *
 * Inline SVG rather than a CSS grid so the whole chart scrolls as one unit on a
 * narrow screen instead of reflowing into an unreadable shape.
 */
const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;

/** Four buckets. More than that is noise at this cell size. */
function intensity(events: number, busiest: number): number {
  if (events === 0) return 0;
  if (busiest <= 1) return 1;
  const share = events / busiest;
  if (share <= 0.25) return 1;
  if (share <= 0.5) return 2;
  if (share <= 0.75) return 3;
  return 4;
}

const FILL = [
  "fill-muted",
  "fill-primary/25",
  "fill-primary/50",
  "fill-primary/75",
  "fill-primary",
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function ActivityHeatmap({
  days,
  busiestDay,
  today,
}: {
  days: ActivityDay[];
  busiestDay: number;
  /** YYYY-MM-DD. Passed in so the component never reads the clock. */
  today: string;
}) {
  if (days.length === 0) return null;

  // Pad the front so the first column starts on a Sunday and the weekday rows
  // line up. Without this the grid is offset and the month labels lie.
  const firstDate = new Date(`${days[0].date}T00:00:00.000Z`);
  const leadingBlanks = firstDate.getUTCDay();

  const cells: (ActivityDay | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...days,
  ];

  const weeks = Math.ceil(cells.length / 7);
  const width = weeks * PITCH;
  const height = 7 * PITCH;
  const labelHeight = 16;

  // One label per month, at the week its first day falls in.
  const monthLabels: { x: number; label: string }[] = [];
  let lastMonth = -1;
  cells.forEach((cell, i) => {
    if (!cell) return;
    const month = new Date(`${cell.date}T00:00:00.000Z`).getUTCMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      const week = Math.floor(i / 7);
      const previous = monthLabels[monthLabels.length - 1];
      if (!previous || week * PITCH - previous.x > 28) {
        monthLabels.push({ x: week * PITCH, label: MONTHS[month] });
      }
    }
  });

  const todayIndex = cells.findIndex((c) => c?.date === today);

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height + labelHeight}
        viewBox={`0 0 ${width} ${height + labelHeight}`}
        role="img"
        aria-label={`Activity from ${days[0].date} to ${days[days.length - 1].date}`}
        className="min-w-full"
      >
        {monthLabels.map((m) => (
          <text
            key={`${m.label}-${m.x}`}
            x={m.x}
            y={11}
            className="fill-muted-foreground text-[9px]"
          >
            {m.label}
          </text>
        ))}

        {cells.map((cell, i) => {
          if (!cell) return null;
          const week = Math.floor(i / 7);
          const day = i % 7;
          const x = week * PITCH;
          const y = day * PITCH + labelHeight;

          if (cell.isFuture) {
            return (
              <rect
                key={cell.date}
                x={x + 0.5}
                y={y + 0.5}
                width={CELL - 1}
                height={CELL - 1}
                rx={2}
                fill="none"
                className="stroke-border"
                strokeWidth={1}
              >
                <title>{`${cell.date}: not yet`}</title>
              </rect>
            );
          }

          return (
            <rect
              key={cell.date}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx={2}
              className={FILL[intensity(cell.events, busiestDay)]}
            >
              <title>
                {cell.events === 0
                  ? `${cell.date}: nothing recorded`
                  : `${cell.date}: ${cell.events} action${cell.events === 1 ? "" : "s"}`}
              </title>
            </rect>
          );
        })}

        {/* Today, so the boundary between done and not-yet is findable. */}
        {todayIndex >= 0 ? (
          <rect
            x={Math.floor(todayIndex / 7) * PITCH - 1}
            y={(todayIndex % 7) * PITCH + labelHeight - 1}
            width={CELL + 2}
            height={CELL + 2}
            rx={3}
            fill="none"
            className="stroke-foreground"
            strokeWidth={1.5}
          >
            <title>{`${today}: today`}</title>
          </rect>
        ) : null}
      </svg>

      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span>Less</span>
          {FILL.map((fill, i) => (
            <svg key={i} width={CELL} height={CELL} aria-hidden>
              <rect width={CELL} height={CELL} rx={2} className={fill} />
            </svg>
          ))}
          <span>More</span>
        </span>
        <span className="flex items-center gap-1.5">
          <svg width={CELL} height={CELL} aria-hidden>
            <rect
              x={0.5}
              y={0.5}
              width={CELL - 1}
              height={CELL - 1}
              rx={2}
              fill="none"
              className="stroke-border"
              strokeWidth={1}
            />
          </svg>
          <span>not yet</span>
        </span>
      </div>
    </div>
  );
}
