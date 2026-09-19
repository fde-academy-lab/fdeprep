/** Screen S1. docs/01 section S1 fixes the copy and the three refusals. */
import { githubConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold">Sign in to FDE Prep</h1>
      <p className="mt-2 text-text-dim">
        Access is granted through your FDE Academy GitHub account.
      </p>

      {message && (
        <p
          role="status"
          className={`mt-6 border px-3 py-2 ${
            error === "signed_out"
              ? "border-border text-text-dim"
              : "border-fail/40 bg-surface text-fail"
          }`}
        >
          {message}
        </p>
      )}

      {configured ? (
        <a
          href={start}
          className="mt-6 inline-block border border-accent px-4 py-2 text-center text-accent"
        >
          Continue with GitHub
        </a>
      ) : (
        <p className="mt-6 border border-border bg-surface px-3 py-2 text-text-dim">
          This deployment has no GitHub application configured, so there is nothing to sign in
          to yet. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and AUTH_SECRET, or set
          AUTH_DEV_LEARNER=1 to run without sign-in on your own machine.
        </p>
      )}

      <p className="mt-8 text-text-faint">
        Trouble signing in? Contact your programme manager.
      </p>
    </main>
  );
}
