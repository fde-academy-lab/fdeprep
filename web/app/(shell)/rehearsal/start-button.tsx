"use client";

/**
 * The confirmation S8 requires before a sitting starts.
 *
 * It names the duration and the remaining allowance, because starting one
 * spends an allowance whether or not the learner finishes, and a learner who
 * clicks this by accident has lost half their week's rehearsals.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogForm, request } from "@/components/ui/dialog";

interface Props {
  durationMinutes: number;
  problemCount: number;
  remaining: number;
}

export default function StartButton(props: Props) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  return (
    <div>
      <Button variant="primary" size="lg" onClick={() => setAsking(true)}>
        <Play aria-hidden /> Start a rehearsal
      </Button>
      <DialogForm open={asking} onClose={() => setAsking(false)} title="Start a rehearsal"
                  submitLabel="Start" busyLabel="Starting"
                  onSubmit={async () => {
                    const { response, data } = await request("/api/rehearsal", { method: "POST" });
                    // The route's own sentence, such as the cap's, is the one a learner can act on.
                    if (!response.ok) {
                      throw new Error(typeof data?.["message"] === "string" ? data["message"]
                        : "That did not start. Try again.");
                    }
                    router.push(`/rehearsal/${String(data?.["id"])}`);
                    return null;
                  }}>
        <p>
          Start a {props.durationMinutes} minute rehearsal over {props.problemCount} problems? You
          have {props.remaining} left this week, and starting spends one whether or not you finish.
        </p>
      </DialogForm>
    </div>
  );
}
