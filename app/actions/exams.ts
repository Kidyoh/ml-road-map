"use server";

/**
 * Exam writes. Thin on purpose: the session is resolved here and everything
 * else - the unlock check, the deadline, the grading - lives in lib/exams.ts,
 * where it can be tested without Next and cannot be skipped by calling the
 * action directly.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { issueCertificate, startAttempt, submitAttempt } from "@/lib/exams";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return {
    userId: session.user.id,
    entryTrack: session.user.entryTrack ?? null,
    name: session.user.name ?? "",
  };
}

export async function startExam(slug: string) {
  const { userId, entryTrack } = await requireUser();
  await startAttempt(userId, entryTrack, slug);
  revalidatePath("/map");
  redirect(`/exam/${slug}`);
}

export async function submitExam(
  slug: string,
  attemptId: string,
  responses: Record<string, string>,
) {
  const { userId } = await requireUser();
  await submitAttempt(userId, attemptId, responses);
  // A pass changes what is unlocked everywhere, not just on this page.
  revalidatePath("/map");
  revalidatePath("/profile");
  revalidatePath(`/exam/${slug}`);
}

export async function claimCertificate(formData: FormData) {
  const { userId, entryTrack, name } = await requireUser();
  const typed = String(formData.get("name") ?? "").trim();
  const { id } = await issueCertificate(userId, entryTrack, typed || name);
  revalidatePath("/profile");
  redirect(`/certificate/${id}`);
}
