"use client";

/** The workspace, the rehearsal shell or the voice cockpit, failing to render.
 *  components/ui/page-error.tsx says why. */
import { PageError } from "@/components/ui/page-error";

export default function FocusError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <PageError {...props} />;
}
