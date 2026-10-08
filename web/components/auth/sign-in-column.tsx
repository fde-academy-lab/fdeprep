/**
 * The single column docs/01 S1 draws, for the sign-in screen and the invite
 * page: the wordmark, then whatever the page says, with one button at most.
 * The wordmark is not a link, so the button is the only stop for a keyboard.
 */
import { LogIn } from "lucide-react";
import { Wordmark } from "@/components/ui/logo";

export function SignInColumn({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Wordmark className="text-text" />
        {children}
      </div>
    </main>
  );
}

export function GitHubButton({ href }: { href: string }) {
  return (
    <a href={href}
       className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-control bg-text
                  font-medium text-bg hover:bg-white active:translate-y-px">
      <LogIn aria-hidden className="size-4" /> Continue with GitHub
    </a>
  );
}

export function NotSetUp({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 rounded-control border border-border bg-surface px-3 py-2.5 text-text-dim">
      {children}
    </p>
  );
}
