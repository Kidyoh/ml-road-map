import Link from "next/link";

import type { ExamSummary } from "@/lib/progress";

const STATE_TEXT: Record<ExamSummary["state"], string> = {
  locked: "locked",
  open: "ready",
  in_progress: "in progress",
  cooldown: "retake soon",
  passed: "passed",
};

/**
 * Every exam and where the learner stands on it.
 *
 * The best score is shown, not the latest, and the number of attempts sits
 * next to it. Both matter: a pass on the fourth attempt is still a pass, and
 * the count is the honest context for it.
 */
export function ExamRecord({ exams }: { exams: ExamSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            <th className="pb-2 font-normal">Exam</th>
            <th className="pb-2 font-normal">Status</th>
            <th className="pb-2 text-right font-normal">Best</th>
            <th className="pb-2 text-right font-normal">Attempts</th>
          </tr>
        </thead>
        <tbody>
          {exams.map((exam) => (
            <tr key={exam.id} className="border-t">
              <td className="py-2 pr-3">
                <Link href={`/exam/${exam.slug}`} className="hover:underline">
                  {exam.title}
                </Link>
              </td>
              <td className="text-muted-foreground py-2 pr-3 text-xs whitespace-nowrap">
                {exam.waived && exam.state !== "passed"
                  ? "waived by entry track"
                  : STATE_TEXT[exam.state]}
              </td>
              <td className="py-2 text-right tabular-nums">
                {exam.bestCorrect !== null ? `${exam.bestCorrect}/${exam.bestTotal}` : "—"}
              </td>
              <td className="text-muted-foreground py-2 text-right tabular-nums">
                {exam.attemptCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
