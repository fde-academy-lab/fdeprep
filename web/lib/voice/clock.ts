/**
 * m:ss, for both sides of the line.
 *
 * It lives here rather than next to the instruments because the debrief is a
 * server component and the instruments are a client one, and a server
 * component calling a function exported from a "use client" module fails at
 * request time with a message about invoking a client function from the
 * server. Nothing about formatting a duration is client-only, so the function
 * moves rather than the caller.
 *
 * docs/07 section 3: no number longer than three characters during an answer.
 * A clock is read as a time rather than a number, which is why 4:45 is fine
 * and 285 would not be.
 */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
