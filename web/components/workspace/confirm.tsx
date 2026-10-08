"use client";
/**
 * The questions a workspace asks before an action that cannot be taken back,
 * asked in a dialog rather than through the browser's confirm(). The code,
 * prompt and design workspaces ask the same two, so the sentences live here.
 */
import { useState, type ReactNode } from "react";
import { DialogForm } from "@/components/ui/dialog";

export interface Question {
  line: string;
  /** The button that does it, which is also the dialog's heading. */
  verb: string;
  act: () => void;
  /** Drawn like the button that asked, for the one action nothing undoes. */
  danger?: true;
}

/** Submit on a problem that allows one, in a rehearsal or on Extreme. */
export function submitOnce(rehearsal: boolean, act: () => void): Question {
  return {
    line: rehearsal
      ? "One submit per problem in a rehearsal. Submit this one?"
      : "This is your only submit today on an Extreme problem. Submit it?",
    verb: "Submit", act,
  };
}

export function giveUp(act: () => void): Question {
  return {
    line: "Give up on this problem? The walkthrough opens and the choice is recorded on your attempt.",
    verb: "Give up", danger: true, act,
  };
}

/** Ask with the function; render the node once, anywhere in the workspace. */
export function useConfirm(): [(question: Question) => void, ReactNode] {
  const [question, setQuestion] = useState<Question | null>(null);
  const dialog = (
    <DialogForm open={question !== null} onClose={() => setQuestion(null)}
                title={question?.verb ?? ""} submitLabel={question?.verb ?? ""}
                submitVariant={question?.danger ? "danger" : "primary"}
                onSubmit={async () => {
                  question?.act();
                  return null;
                }}>
      <p>{question?.line}</p>
    </DialogForm>
  );
  return [setQuestion, dialog];
}
