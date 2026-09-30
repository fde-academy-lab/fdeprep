/** Screen S1. docs/01 section S1 fixes the copy and the three refusals. */
import type { Metadata } from "next";
import { LogIn } from "lucide-react";
import { githubConfigured } from "@/lib/auth/config";
import { STAGES } from "@/lib/problems/vocabulary";
import { LogoMark } from "@/components/ui/logo";
import { cn } from "@/components/ui/cn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

/**
 * Every way this screen can be reached with something to say.
 *
 * The first three are docs/01's refusals, word for word, because each one has
 * a different owner and a learner needs to know which door is shut. The rest
 * are the mechanics of the round trip, and they say what to do rather than
 * what broke.
 */
const MESSAGES: Record<string, string> = {
  not_a_member: "Your GitHub account is not in the FDE Academy organisation yet.",
  not_enrolled: "Your account is not enrolled in an active cohort.",
  enrolment_ended: "Your enrolment has ended. Past submissions stay readable for thirty days.",
  cancelled: "You cancelled on GitHub. Nothing was changed. Try again when you are ready.",
  bad_state: "That sign-in link had expired. Start again from this page.",
  github_refused: "GitHub would not complete the sign-in. Wait a moment and try again.",
  not_configured:
    "Sign-in is not configured on this deployment yet. Contact your programme manager.",
  signed_out: "You are signed out.",
};

export default async function SignInPage(
  { searchParams }: { searchParams: Promise<{ error?: string; next?: string }> },
) {
  const { error, next } = await searchParams;
  const message = error ? MESSAGES[error] : undefined;
  const configured = githubConfigured();
  const start = next ? `/api/auth/start?next=${encodeURIComponent(next)}` : "/api/auth/start";

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section aria-hidden className="relative hidden overflow-hidden border-r border-border bg-surface lg:block">
        <div className="pointer-events-none absolute inset-0
                        bg-[radial-gradient(90%_70%_at_10%_0%,rgb(110_151_242/0.10),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <p className="flex items-center gap-2.5 font-semibold text-text"><LogoMark /> FDE Prep</p>
          <div className="max-w-md">
            <p className="text-display font-semibold leading-[1.15] tracking-[-0.02em] text-text">
              Build the agent, break it on purpose, then defend it out loud.
            </p>
            <ol className="mt-10 space-y-5">
              {STAGES.map((stage, index) => (
                <li key={stage.id} className="flex gap-4">
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border font-mono text-meta",
                                      index === 0 ? "border-accent text-accent" : "border-border-strong text-text-faint")}>
                    {index + 1}
                  </span>
                  <span>
                    <span className="block font-medium text-text">{stage.name}</span>
                    <span className="block text-meta text-text-dim">{stage.blurb}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-meta text-text-faint">FDE Academy</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <LogoMark className="size-9" />
          <h1 className="mt-6 text-display font-semibold tracking-[-0.02em] text-text">Sign in to FDE Prep</h1>
          <p className="mt-2 text-text-dim">Access is granted through your FDE Academy GitHub account.</p>

          {message ? (
            <p role="status"
               className={cn("mt-6 rounded-control border px-3 py-2.5",
                             error === "signed_out" ? "border-border bg-surface text-text-dim"
                               : "border-fail/40 bg-fail-soft text-text")}>
              {message}
            </p>
          ) : null}

          {configured ? (
            <a href={start}
               className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-control bg-text
                          font-medium text-bg hover:bg-white active:translate-y-px">
              <LogIn aria-hidden className="size-4" /> Continue with GitHub
            </a>
          ) : (
            <p className="mt-6 rounded-control border border-border bg-surface px-3 py-2.5 text-meta leading-relaxed text-text-dim">
              This deployment has no GitHub application configured, so there is nothing to sign in
              to yet. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and AUTH_SECRET, or set
              AUTH_DEV_LEARNER=1 to run without sign-in on your own machine.
            </p>
          )}

          <p className="mt-8 text-meta text-text-faint">Trouble signing in? Contact your programme manager.</p>
        </div>
      </section>
    </main>
  );
}
