/**
 * The transport test page.
 *
 * Not a screen from docs/07. It is the Phase 7a deliverable: open the socket,
 * stream a microphone, print partial and final transcripts to the console.
 * The cockpit is Phase 7b and this page is thrown away when it arrives.
 */
import Link from "next/link";
import { consentState } from "@/lib/voice/consent";
import { currentLearner } from "@/lib/session/current";
import { VoiceLab } from "./lab";

export const dynamic = "force-dynamic";

export default async function VoiceLabPage() {
  const learner = await currentLearner();
  const { granted } = await consentState(learner.enrolmentId);

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold">Voice transport check</h1>
      <p className="mt-2 text-text-dim">
        Checks the microphone, opens the voice socket and streams 16kHz mono audio to it.
        Transcripts print to the browser console. Nothing on this page shows what you said,
        which is the rule the cockpit is built around.
      </p>

      {granted ? (
        <VoiceLab />
      ) : (
        <p className="mt-6 border border-border bg-surface p-6 text-text-dim">
          No session starts without recording consent.{" "}
          <Link href="/voice/consent" className="text-accent">
            Read what is recorded and accept
          </Link>
          .
        </p>
      )}
    </main>
  );
}
