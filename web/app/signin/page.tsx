/**
 * Screen S1. docs/01 section S1 fixes the copy and the three refusals.
 *
 * One centred column: the wordmark, the heading, one line, one button, and
 * the line saying who to ask. The button is the only thing a keyboard
 * reaches. A deployment with no GitHub application says so in one sentence
 * and names nothing about how it is configured; the variables go to the
 * server log, where whoever runs it will look.
 */
import type { Metadata } from "next";
import { githubConfigured, logSignInNotSetUp } from "@/lib/auth/config";
import { REFUSALS } from "@/lib/auth/refusals";
import { GitHubButton, NotSetUp, SignInColumn } from "@/components/auth/sign-in-column";
import { cn } from "@/components/ui/cn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

/**
 * Every way this screen can be reached with something to say.
 *
 * The refusals come from lib/auth/refusals.ts, the same table the access
 * check decides with, so the screen cannot say something the check did not
 * mean. The rest are the mechanics of the round trip, and they say what to do
 * rather than what broke.
 */
const MESSAGES: Record<string, string> = {
  ...REFUSALS,
  cancelled: "You cancelled on GitHub. Nothing was changed. Try again when you are ready.",
  bad_state: "That sign-in link had expired. Start again from this page.",
  github_refused: "GitHub would not complete the sign-in. Wait a moment and try again.",
  signed_out: "You are signed out.",
};

export default async function SignInPage(
  { searchParams }: { searchParams: Promise<{ error?: string; next?: string }> },
) {
  const { error, next } = await searchParams;
  const message = error ? MESSAGES[error] : undefined;
  // The start and callback routes send not_configured when a variable the
  // round trip needs is missing, so the button would only lead back here.
  const configured = githubConfigured() && error !== "not_configured";
  if (!configured) logSignInNotSetUp();
  const start = next ? `/api/auth/start?next=${encodeURIComponent(next)}` : "/api/auth/start";

  return (
    <SignInColumn>
      <h1 className="mt-8 text-title font-semibold tracking-[-0.01em] text-text">Sign in to FDE Prep</h1>
      <p className="mt-1.5 text-pretty text-text-dim">Access is granted through your FDE Academy GitHub account.</p>

      {message ? (
        <p role="status"
           className={cn("mt-6 rounded-control border px-3 py-2.5",
                         error === "signed_out" ? "border-border bg-surface text-text-dim"
                           : "border-fail/40 bg-fail-soft text-text")}>
          {message}
        </p>
      ) : null}

      {configured ? (
        <>
          <GitHubButton href={start} />
          <p className="mt-8 text-meta text-text-faint">Trouble signing in? Contact your programme manager.</p>
        </>
      ) : (
        <NotSetUp>Sign-in is not set up on this deployment. Contact your programme manager.</NotSetUp>
      )}
    </SignInColumn>
  );
}
