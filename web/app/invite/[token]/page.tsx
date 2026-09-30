/**
 * Where an invite link lands. docs/01 section S1, amended 30 September 2026.
 *
 * Open without a session, because the person holding the link has not signed
 * in yet. It says whether the link can still be used and offers the GitHub
 * sign-in that spends it. It reveals nothing else about the invite: not the
 * cohort, the role or the login it may be bound to, since whoever holds the
 * link may not be who it was sent to.
 */
import type { Metadata } from "next";
import { LogIn } from "lucide-react";
import { githubConfigured } from "@/lib/auth/config";
import { inviteStatus } from "@/lib/auth/invite";
import { REFUSALS } from "@/lib/auth/refusals";
import { LogoMark } from "@/components/ui/logo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your invite" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const status = await inviteStatus(token);
  const configured = githubConfigured();

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <LogoMark className="size-9" />
        <h1 className="mt-6 text-display font-semibold tracking-[-0.02em] text-text">
          {status === "open" ? "You are invited to FDE Prep" : "This invite cannot be used"}
        </h1>

        {status === "open" ? (
          <>
            <p className="mt-2 text-text-dim">
              Sign in with your GitHub account to accept. The link works once, for the first
              account that uses it.
            </p>
            {configured ? (
              <a href={`/api/auth/start?invite=${encodeURIComponent(token)}`}
                 className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-control
                            bg-text font-medium text-bg hover:bg-white active:translate-y-px">
                <LogIn aria-hidden className="size-4" /> Continue with GitHub
              </a>
            ) : (
              <p className="mt-6 rounded-control border border-border bg-surface px-3 py-2.5 text-meta
                            leading-relaxed text-text-dim">
                Sign-in is not configured on this deployment yet. Contact whoever sent the invite.
              </p>
            )}
          </>
        ) : (
          <>
            <p role="status"
               className="mt-6 rounded-control border border-fail/40 bg-fail-soft px-3 py-2.5 text-text">
              {status === "used" ? REFUSALS.invite_used : REFUSALS.invite_invalid}
            </p>
            <p className="mt-6 text-meta text-text-dim">
              Already enrolled? <a href="/signin" className="text-accent underline">Sign in here</a>.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
