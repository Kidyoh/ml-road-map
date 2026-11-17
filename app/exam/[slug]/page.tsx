import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";

import { startExam, submitExam } from "@/app/actions/exams";
import { ExamResults } from "@/components/exam/exam-results";
import { ExamRunner } from "@/components/exam/exam-runner";
import { MdxBody } from "@/components/node/mdx-body";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { loadAllExams } from "@/lib/exam-content";
import { correctNeeded, FINAL_EXAM_ID } from "@/lib/exam-schema";
import { certificateStatus, findExam, loadAttemptViews } from "@/lib/exams";
import { buildGraph } from "@/lib/progress";

export async function generateStaticParams() {
  const exams = await loadAllExams();
  return exams.map((exam) => ({ slug: exam.slug }));
}

export async function generateMetadata({ params }: PageProps<"/exam/[slug]">) {
  const { slug } = await params;
  const exam = await findExam(slug);
  return exam ? { title: exam.frontmatter.title } : {};
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

function waitText(until: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * One exam, in whichever of its states applies to this learner.
 *
 * The page never decides anything. The state comes from buildGraph, derived
 * from attempts and node progress on this request; the questions come from the
 * attempt row, through toAttemptView, which is what keeps answer keys off the
 * wire. Signed out, the exam is described but cannot be started - an attempt
 * has to belong to somebody.
 */
export default async function ExamPage({ params }: PageProps<"/exam/[slug]">) {
  const { slug } = await params;
  const exam = await findExam(slug);
  if (!exam) notFound();

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const now = new Date();

  const graph = await buildGraph(userId, session?.user?.entryTrack ?? null, now);
  const summary = graph.examById.get(exam.id);
  if (!summary) notFound();

  const attempts = userId
    ? await loadAttemptViews(userId, exam.id, summary.state === "passed", now)
    : [];
  const active = attempts.find((a) => a.status === "active") ?? null;
  const latestFinished = attempts.find((a) => a.status !== "active") ?? null;
  const passedAttempt = attempts.find((a) => a.status === "passed") ?? null;
  const shown = passedAttempt ?? latestFinished;

  const nodeLinks = Object.fromEntries(
    graph.nodes.map((n) => [n.id, { slug: n.slug, title: n.title }]),
  );
  const needed = correctNeeded(summary.questionCount, summary.passMark);
  const isFinal = exam.id === FINAL_EXAM_ID;

  const blockingNodes = summary.blockingNodeIds
    .map((id) => graph.byId.get(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
  const blockingExams = summary.blockingExamIds
    .map((id) => graph.examById.get(id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  // What passing this opens, for the passed banner.
  const nextNode = graph.nodes.find(
    (n) => n.status === "published" && (n.state === "open" || n.state === "in_progress"),
  );
  const nextExam = graph.exams.find((e) => e.id !== exam.id && e.state === "open");
  const certificate = userId && isFinal ? certificateStatus(graph, userId) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <nav className="text-muted-foreground flex items-center justify-between gap-4 text-sm">
        <span>
          <Link href="/map" className="hover:text-foreground transition-colors">
            Map
          </Link>
          <span className="mx-2" aria-hidden>
            /
          </span>
          <span>{isFinal ? "Final exam" : `Phase ${summary.phase} exam`}</span>
        </span>
        <ThemeToggle />
      </nav>

      <header className="flex flex-col gap-3">
        <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
          Exam
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {exam.frontmatter.title}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{summary.questionCount} questions</Badge>
          <Badge variant="outline">{summary.timeLimitMinutes} minutes</Badge>
          <Badge variant="outline">
            {needed} of {summary.questionCount} to pass
          </Badge>
          {summary.waived && summary.state !== "passed" ? (
            <Badge variant="secondary">Not required for your entry track</Badge>
          ) : null}
        </div>
      </header>

      {active ? (
        <ExamRunner
          attemptId={active.id}
          questions={active.questions.map((q) => ({
            id: q.id,
            covers: q.covers,
            prompt: q.prompt,
            answerType: q.answerType,
          }))}
          remainingMs={Math.max(0, active.deadlineAt.getTime() - now.getTime())}
          needed={active.needed}
          submit={async (attemptId, responses) => {
            "use server";
            await submitExam(slug, attemptId, responses);
          }}
        />
      ) : (
        <>
          {summary.state === "passed" ? (
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
                <p className="max-w-prose">
                  {isFinal
                    ? "You passed the final exam. The capstone is open."
                    : `You passed this exam. Phase ${summary.gatesPhase} is open.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {certificate?.eligible ? (
                    <Button asChild size="sm">
                      <Link href="/profile#certificate">Claim your certificate</Link>
                    </Button>
                  ) : nextNode ? (
                    <Button asChild size="sm">
                      <Link href={`/node/${nextNode.slug}`}>
                        Continue: {nextNode.id} {nextNode.title}
                      </Link>
                    </Button>
                  ) : nextExam ? (
                    <Button asChild size="sm">
                      <Link href={`/exam/${nextExam.slug}`}>Next: {nextExam.title}</Link>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/map">Back to the map</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {summary.state === "locked" ? (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-widest uppercase">
                  <Lock className="size-4" aria-hidden />
                  Locked
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm leading-relaxed">
                <p className="max-w-prose">
                  {isFinal
                    ? "The final exam opens once every phase exam is passed."
                    : `This exam opens once every node in phase ${summary.phase} is passed.`}
                </p>
                {blockingNodes.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {blockingNodes.map((n) => (
                      <li key={n.id} className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {n.id}
                        </Badge>
                        <Link href={`/node/${n.slug}`} className="text-primary hover:underline">
                          {n.title}
                        </Link>
                        <span className="text-muted-foreground text-xs">
                          {n.state.replace("_", " ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {blockingExams.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {blockingExams.map((e) => (
                      <li key={e.id}>
                        <Link href={`/exam/${e.slug}`} className="text-primary hover:underline">
                          {e.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!userId ? (
                  <p className="text-muted-foreground max-w-prose">
                    You are signed out, so nothing counts as passed yet.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {summary.state === "cooldown" && summary.retryAt ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed">
              You can try again in {waitText(summary.retryAt, now)} (
              {stamp(summary.retryAt)}). The wait is there so the retake follows
              some actual revision; the questions will have different numbers.
            </p>
          ) : null}

          {summary.state === "open" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium tracking-widest uppercase">
                  {summary.attemptCount > 0 ? "Retake" : "Before you start"}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm leading-relaxed">
                <ul className="text-muted-foreground flex max-w-prose list-disc flex-col gap-1.5 pl-5">
                  <li>
                    {summary.questionCount} questions in {summary.timeLimitMinutes}{" "}
                    minutes. The clock starts when you press the button and does
                    not pause.
                  </li>
                  <li>
                    Every answer is a number or a short exact value that you work
                    out. Use Python, a notebook, a calculator &mdash; whatever you
                    would use on the job.
                  </li>
                  <li>
                    You need {needed} correct to pass. If you do not, there is a{" "}
                    {summary.cooldownHours}-hour wait and the next paper uses
                    different numbers.
                  </li>
                  <li>
                    {isFinal
                      ? "Passing opens the capstone."
                      : `Passing opens phase ${summary.gatesPhase}.`}
                  </li>
                </ul>
                {userId ? (
                  <form
                    action={async () => {
                      "use server";
                      await startExam(slug);
                    }}
                  >
                    <Button type="submit">
                      {summary.attemptCount > 0 ? "Start a new attempt" : "Start the exam"}
                    </Button>
                  </form>
                ) : (
                  <p className="text-muted-foreground">
                    <Link href="/map" className="text-primary hover:underline">
                      Sign in
                    </Link>{" "}
                    to take this exam.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {shown ? (
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-medium tracking-widest uppercase">
                {passedAttempt ? "Your passing attempt" : "Your last attempt"}
              </h2>
              <ExamResults attempt={shown} nodeLinks={nodeLinks} />
            </section>
          ) : null}

          {summary.state !== "passed" ? (
            <article className="border-t pt-6">
              <MdxBody source={exam.body} />
            </article>
          ) : null}

          {attempts.length > 1 ? (
            <section className="flex flex-col gap-3 border-t pt-6">
              <h2 className="text-sm font-medium tracking-widest uppercase">
                All attempts
              </h2>
              <ul className="flex flex-col gap-1.5 text-sm">
                {attempts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3">
                    <span className="text-muted-foreground font-mono text-xs">
                      {stamp(a.startedAt)}
                    </span>
                    <span className="tabular-nums">
                      {a.correct ?? 0}/{a.total}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {a.status === "passed"
                        ? "passed"
                        : a.timedOut
                          ? "timed out"
                          : "not passed"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
