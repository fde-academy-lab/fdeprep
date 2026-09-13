"use client";

/**
 * The last-resort error boundary. It owns its own html and body because it
 * replaces the root layout when the root layout is what failed.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0B0C0E", color: "#E6E9EF", fontFamily: "system-ui", padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>The page did not load.</h1>
        <p style={{ color: "#9AA3B0", marginTop: 8 }}>
          Nothing you submitted was lost. Reload to try again, and if it keeps happening,
          say so in the cohort channel.
        </p>
        <button
          type="button" onClick={reset}
          style={{ marginTop: 16, padding: "4px 12px", color: "#4F8EF7",
                   border: "1px solid #4F8EF7", borderRadius: 4, background: "transparent" }}>
          Reload
        </button>
      </body>
    </html>
  );
}
