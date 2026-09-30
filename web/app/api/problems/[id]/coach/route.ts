/**
 * The live coach. POST the editor text and the idle time, get back at most one
 * nudge. docs/04 section 2.1.
 *
 * Deterministic and model-free: CLAUDE.md says learner code never reaches a
 * model endpoint, and this route never calls one. The code is read with the
 * problem's own patterns on the server and dropped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { coachReply } from "@/lib/coach/state";
import { learnerOrNull } from "@/lib/session/current";

const Body = z.object({
  // An editor holding more than this is not a solution being written.
  code: z.string().max(64_000),
  idleMinutes: z.number().min(0).max(24 * 60).default(0),
  dismissed: z.array(z.string().max(64)).max(32).default([]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const learner = await learnerOrNull();
  if (!learner) {
    return NextResponse.json(
      { message: "Your session ended. Sign in again and the coach picks up where it was." },
      { status: 401 });
  }
  const { id } = await params;
  const problemId = Number(id);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(problemId) || !parsed.success) {
    return NextResponse.json(
      { message: "The coach could not read that request. Reload the page to reconnect it." },
      { status: 400 });
  }
  return NextResponse.json(await coachReply({
    enrolmentId: learner.enrolmentId, problemId, ...parsed.data,
  }));
}
