"use client";

/**
 * What a page that failed to render shows, inside the application rather
 * than in place of it. Used by the error boundaries in app/(shell) and
 * app/(focus).
 *
 * Before these existed, every page error fell through to global-error.tsx,
 * which replaces the whole document, header included, and whose Reload asked
 * React to draw the same failed tree again without fetching it. Here, Try
 * again re-fetches the page from the server (retry, stable since Next 16.3),
 * the way out stays on screen, and the reference is the digest Next writes
 * beside the error in the server log, so an admin can find the cause from
 * what the learner reads out.
 */
import { useEffect } from "react";
import { Button, ButtonLink } from "./button";

export function PageError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-10" role="alert">
      <h1 className="text-title font-semibold text-text">This page did not load.</h1>
      <p className="mt-2 leading-relaxed text-text-dim">
        The server hit an error while drawing it. Anything you had already saved is kept. Try
        again, and if it fails twice, send an admin the reference below.
      </p>
      <div className="mt-5 flex flex-wrap gap-2.5">
        <Button variant="primary" onClick={() => retry()}>Try again</Button>
        <ButtonLink href="/" variant="ghost">Go to the home page</ButtonLink>
      </div>
      {error.digest ? (
        <p className="mt-5 text-meta text-text-faint">
          Reference <code className="font-mono text-text-dim">{error.digest}</code>
        </p>
      ) : null}
    </main>
  );
}
