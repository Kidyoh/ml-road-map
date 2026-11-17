import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/exam/print-button";
import { loadCertificate } from "@/lib/exams";

export async function generateMetadata({ params }: PageProps<"/certificate/[id]">) {
  const { id } = await params;
  const cert = await loadCertificate(id);
  if (!cert) return {};
  return {
    title: `Certificate: ${cert.name}`,
    description: `${cert.name} completed the ML Roadmap: seven phase exams, the final exam and the capstone.`,
    // A certificate is shared by link, on purpose. It should not be something
    // a search engine surfaces for a person's name unasked.
    robots: { index: false, follow: false },
  };
}

const day = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * A certificate, public to anyone holding the link.
 *
 * Rendered from the database on every request, which is what makes it worth
 * linking to: the page is the verification. It shows the name the learner
 * chose, the date of issue and exam scores - nothing else about the account.
 */
export default async function CertificatePage({
  params,
}: PageProps<"/certificate/[id]">) {
  const { id } = await params;
  const cert = await loadCertificate(id);
  if (!cert) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12 print:py-0">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground font-mono text-xs tracking-widest uppercase transition-colors"
        >
          ML Roadmap
        </Link>
        <PrintButton />
      </div>

      <article className="flex flex-col items-center gap-8 rounded-lg border-2 px-8 py-14 text-center print:border-black">
        <p className="text-muted-foreground font-mono text-xs tracking-[0.3em] uppercase">
          Certificate of completion
        </p>

        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">This certifies that</p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance">
            {cert.name}
          </h1>
          <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed text-pretty">
            completed the ML Roadmap: forty nodes from the tooling floor to a
            deployed system, an exam at the end of every phase, a comprehensive
            final exam and the capstone project.
          </p>
        </div>

        {cert.exams.length > 0 ? (
          <table className="w-full max-w-md text-left text-sm">
            <tbody>
              {cert.exams.map((exam) => (
                <tr key={exam.title} className="border-t last:border-b">
                  <td className="py-2 pr-4">{exam.title}</td>
                  <td className="py-2 text-right tabular-nums">
                    {exam.correct}/{exam.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="text-muted-foreground flex flex-col gap-1 text-xs">
          <p>Issued {day(cert.issuedAt)}</p>
          <p className="font-mono">Certificate {cert.id}</p>
        </div>
      </article>

      <p className="text-muted-foreground max-w-prose text-xs leading-relaxed print:hidden">
        Exams are timed and graded automatically: each answer is a value the
        learner computed, never a choice from a list. This page is generated
        from the live record, so if you are reading it at this address the
        certificate is genuine.
      </p>
    </main>
  );
}
