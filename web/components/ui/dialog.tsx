"use client";
/**
 * A modal on the native dialog element, the way the command palette and the
 * diagram already open theirs. showModal makes the page behind it inert and
 * keeps Tab inside, Escape closes it, a click on the backdrop closes it, and
 * focus goes back to whatever opened it. It rises in over 180ms, the panel
 * duration in docs/08 section 5.
 *
 * DialogForm is what an action uses in place of prompt(), confirm() and
 * alert(): the sentence the action needs, the fields it asks for, and the
 * route's refusal shown as a line inside the dialog.
 */
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./button";
import { cn } from "./cn";

/** The first thing to type into, or else the footer's first button, which is Cancel. */
const FIRST = "[data-autofocus], textarea, select, input:not([type=hidden]):not([hidden])";

export function Dialog({ open, onClose, title, children, footer, onSubmit, className }: {
  open: boolean;
  /** Called however the dialog closed: Escape, the close button, the backdrop or a caller. */
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Buttons, right-aligned under the body. */
  footer?: ReactNode;
  /** Given, the dialog's content is a form and this receives its submit. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  // A press that starts on a field and ends on the backdrop is a text
  // selection, not a request to close, so both ends have to be the backdrop.
  const pressedBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      element.showModal();
      const first = element.querySelector<HTMLElement>(FIRST) ??
        element.querySelector<HTMLElement>("[data-footer] button");
      first?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const content = (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 pl-5 pr-3">
        <h2 id={titleId} className="text-lead font-semibold text-text">{title}</h2>
        <Button variant="ghost" size="sm" aria-label="Close" onClick={() => dialog.current?.close()}>
          <X aria-hidden />
        </Button>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
      {footer ? (
        <div data-footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
      ) : null}
    </>
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => {
        onClose();
        if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      }}
      onMouseDown={(event) => { pressedBackdrop.current = event.target === dialog.current; }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === dialog.current) dialog.current?.close();
      }}
      // A dialog can sit inside a table cell, so it resets what a cell passes down.
      className={cn(
        "m-auto w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-panel border border-border-strong",
        "bg-surface p-0 text-left text-body font-normal whitespace-normal text-text",
        "shadow-[0_24px_64px_-12px_rgb(0_0_0/0.6)] backdrop:bg-bg/70 backdrop:backdrop-blur-[2px]",
        "open:rise-in", className)}
    >
      {/* Nothing inside while closed, so a page of rows carries no hidden copies of the text. */}
      {!open ? null : onSubmit ? <form onSubmit={onSubmit}>{content}</form> : content}
    </dialog>
  );
}

/** The line a dialog shows when a route refused, quoting the route's own message. */
export function serverSaid(message: string): string {
  return `That did not go through. The server said: ${message}`;
}

/**
 * POST and read the JSON reply, for a dialog's submit. A refusal throws the
 * line the dialog shows, with the route's own message in it.
 */
export async function post<T = Record<string, unknown>>(
  url: string, body?: unknown,
): Promise<T> {
  const { response, data } = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw refusal(response, data);
  return data as T;
}

/** The fetch under post(), for a caller that reads a refusal's body itself. */
export async function request(url: string, init: RequestInit): Promise<{
  response: Response; data: Record<string, unknown> | null;
}> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("That did not go through. The server did not answer. Try again.");
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { response, data };
}

export function refusal(response: Response, data: Record<string, unknown> | null): Error {
  const message = typeof data?.["message"] === "string" ? data["message"]
    : `${response.status} ${response.statusText}`.trim() + ".";
  return new Error(serverSaid(message));
}

/**
 * Every field marked required has something in it. `required` alone accepts
 * a reason made of spaces, which the server then refuses.
 */
function complete(form: HTMLFormElement): boolean {
  if (!form.checkValidity()) return false;
  return Array.from(form.elements).every((element) =>
    !(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) ||
    !element.required || element.type === "file" || element.value.trim() !== "");
}

/**
 * A dialog that sends a form. The submit stays disabled until every required
 * field is filled. `onSubmit` resolves to what the dialog shows afterwards,
 * with one button reading Done, or to null to close; it rejects with the line
 * to show inside the dialog.
 */
export function DialogForm({
  open, onClose, title, children, submitLabel, busyLabel, cancelLabel = "Cancel",
  submitVariant = "primary", onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The sentence the action carries, and its fields. */
  children: ReactNode;
  submitLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  submitVariant?: ButtonVariant;
  onSubmit: (data: FormData) => Promise<ReactNode | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReactNode | null>(null);
  const [ready, setReady] = useState(false);
  // Each opening starts clean: the fields are new, since a closed dialog holds
  // none, and no error or result is left from last time.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setResult(null);
      setReady(false);
    }
  }

  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = form.current?.closest("form");
    if (open && node) setReady(complete(node));
  }, [open]);

  // The submit button goes when the result arrives, so focus moves to Done.
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (result !== null) done.current?.focus();
  }, [result]);

  const check = (event: FormEvent<HTMLElement>) => {
    const node = event.currentTarget.closest("form");
    if (node) setReady(complete(node));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const node = event.currentTarget;
    if (busy || result !== null || !complete(node)) return;
    setBusy(true);
    setError(null);
    try {
      const shown = await onSubmit(new FormData(node));
      if (shown === null) onClose();
      else setResult(shown);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} onSubmit={submit}
            footer={result !== null ? (
              <Button ref={done} variant="primary" onClick={onClose}>Done</Button>
            ) : (
              <>
                <Button disabled={busy} onClick={onClose}>{cancelLabel}</Button>
                <Button type="submit" variant={submitVariant} disabled={!ready || busy}>
                  {busy && busyLabel ? busyLabel : submitLabel}
                </Button>
              </>
            )}>
      <div ref={form} className="space-y-4" onInput={check} onChange={check}>
        {result !== null ? result : children}
        {error ? <p role="alert" className="text-fail">{error}</p> : null}
      </div>
    </Dialog>
  );
}
