/**
 * Where an invite link lands. docs/01 section S1, amended 30 September 2026.
 *
 * Open without a session, because the person holding the link has not signed
 * in yet. It says whether the link can still be used and offers the GitHub
 * sign-in that spends it. It reveals nothing else about the invite: not the
 * cohort, the role or the login it may be bound to, since whoever holds the
 * link may not be who it was sent to. The same column as the sign-in screen.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { githubConfigured, logSignInNotSetUp } from "@/lib/auth/config";
import { inviteStatus } from "@/lib/auth/invite";
import { REFUSALS } from "@/lib/auth/refusals";
import { GitHubButton, NotSetUp, SignInColumn } from "@/components/auth/sign-in-column";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your invite" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const status = await inviteStatus(token);
  const configured = githubConfigured();
  if (status === "open" && !configured) logSignInNotSetUp();

  return (
    <SignInColumn>
      <h1 className="mt-8 text-title font-semibold tracking-[-0.01em] text-text">
        {status === "open" ? "You are invited to FDE Prep" : "This invite cannot be used"}
      </h1>

      {status === "open" ? (
        <>
          <p className="mt-1.5 text-pretty text-text-dim">
            Sign in with GitHub to accept. The link works once, for the first account that uses it.
          </p>
          {configured ? (
            <GitHubButton href={`/api/auth/start?invite=${encodeURIComponent(token)}`} />
          ) : (
            <NotSetUp>Sign-in is not set up on this deployment. Contact whoever sent the invite.</NotSetUp>
          )}
        </>
      ) : (
        <>
          <p role="status"
             className="mt-6 rounded-control border border-fail/40 bg-fail-soft px-3 py-2.5 text-text">
            {status === "used" ? REFUSALS.invite_used : REFUSALS.invite_invalid}
          </p>
          <p className="mt-8 text-meta text-text-faint">
            Already enrolled? <Link href="/signin" className="text-text-dim underline underline-offset-2
                                                             hover:text-text">Sign in</Link>.
          </p>
        </>
      )}
    </SignInColumn>
  );
}
