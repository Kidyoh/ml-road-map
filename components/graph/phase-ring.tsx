import { cn } from "@/lib/utils";

/**
 * Per-phase progress ring. An SVG rather than a CSS conic-gradient so the track
 * and the fill can carry different colours in both themes without a second
 * element stacked on top.
 */
export function PhaseRing({
  passed,
  total,
  className,
}: {
  passed: number;
  total: number;
  className?: string;
}) {
  const size = 40;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? passed / total : 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={`${passed} of ${total} nodes passed`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        className="stroke-border"
        strokeWidth={stroke}
      />
      {fraction > 0 ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-primary"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-foreground text-[0.65rem] font-medium tabular-nums"
      >
        {passed}/{total}
      </text>
    </svg>
  );
}
