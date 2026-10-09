import { NextResponse } from "next/server";
import { signedOut } from "@/lib/http/failure";
import { learnerOrNull } from "@/lib/session/current";
import { readableSubmission } from "@/lib/session/records";
import { publicView } from "@/lib/submissions/view";

/**
 * The polling fallback for clients that cannot hold an event stream open.
 *
 * The learner whose submission it is reads it, and so do faculty of their
 * cohort and admins (lib/session/records.ts). Anyone else gets the answer a
 * number nobody holds gets, so counting through ids confirms nothing. Until
 * 8 October 2026 this answered anyone with a cookie of the right name (S15.13).
 */
export async function GET(
  _request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await learnerOrNull();
  if (!viewer) return signedOut();
  const submissionId = Number((await params).id);
  if (!(await readableSubmission(viewer, submissionId))) return notFound();
  try {
    return NextResponse.json(await publicView(submissionId));
  } catch {
    return notFound();
  }
}

function notFound(): NextResponse {
  return NextResponse.json(
    { message: "That submission was not found. Open it again from the problem page." },
    { status: 404 });
}
