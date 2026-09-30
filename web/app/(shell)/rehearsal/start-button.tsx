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

interface Props {
  durationMinutes: number;
  problemCount: number;
  remaining: number;
}

export default function StartButton(props: Props) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const start = async () => {
    const agreed = confirm(
      `Start a ${props.durationMinutes} minute rehearsal over ${props.problemCount} problems?\n\n` +
      `You have ${props.remaining} left this week, and starting spends one whether or not ` +
      "you finish.");
    if (!agreed) return;

    setStarting(true);
    setNotice(null);
    const response = await fetch("/api/rehearsal", { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setNotice(body.message ?? "That did not start. Try again.");
      setStarting(false);
      return;
    }
    const { id } = (await response.json()) as { id: number };
    router.push(`/rehearsal/${id}`);
  };

  return (
    <div>
      <Button variant="primary" size="lg" onClick={start} disabled={starting}>
        <Play aria-hidden /> {starting ? "Starting" : "Start a rehearsal"}
      </Button>
      {notice ? (
        <p role="alert" className="mt-3 rounded-control border border-warn/40 bg-warn-soft px-3 py-2 text-text">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
