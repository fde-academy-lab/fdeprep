/**
 * The text a learner is typing, held where a keystroke does not re-render the
 * workspace.
 *
 * The three workspaces used to keep the answer in React state, so every key
 * re-rendered the whole screen: the brief, the diagram, the header and the
 * results, then the editor. In development mode on a CPU slowed four times,
 * that measured 152 ms per key event at the median.
 *
 * Now the live text sits in `live`, which is what Run and Submit read, and a
 * copy settles into React state after a short pause for everything that only
 * needs the text as of the last pause: the checklist, the word count, the diff
 * and the coach. The draft is still saved on every key, so a reload never
 * loses more than the key being pressed.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Long enough to cover a burst of typing, short enough to read as live. */
export const SETTLE_MS = 120;

type Store = Pick<Storage, "getItem" | "setItem">;

export class DraftBuffer {
  live: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly store: Store | null;
  private readonly key: string;
  private readonly settleMs: number;
  private readonly onSettle: (text: string) => void;

  constructor(options: {
    store: Store | null; key: string; initial: string; settleMs: number;
    onSettle: (text: string) => void;
  }) {
    this.store = options.store;
    this.key = options.key;
    this.live = options.initial;
    this.settleMs = options.settleMs;
    this.onSettle = options.onSettle;
  }

  /** Every key. Saves the draft now and settles once the typing pauses. */
  change(next: string): void {
    this.live = next;
    this.save(next);
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onSettle(next);
    }, this.settleMs);
  }

  /**
   * A replacement from outside the editor: a saved draft on arrival, the
   * starter code, an outline. It settles at once, and it cancels any settle
   * still pending from typing, which would otherwise land after it and put
   * the older text back.
   */
  replace(next: string, options: { save: boolean }): void {
    this.cancel();
    this.live = next;
    if (options.save) this.save(next);
    this.onSettle(next);
  }

  /** The saved draft, or null when there is none or storage is blocked. */
  saved(): string | null {
    try {
      return this.store?.getItem(this.key) ?? null;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private save(text: string): void {
    try {
      this.store?.setItem(this.key, text);
    } catch {
      // Storage blocked: the draft lives until the page closes.
    }
  }
}

/** Storage when the browser allows it; a sandboxed frame can throw on the read. */
function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The buffer as a hook. `settled` is React state; `draft.live` is not, and
 * reading it never causes a render.
 */
export function useDraft(key: string, initial: string, settleMs = SETTLE_MS) {
  const [settled, setSettled] = useState(initial);
  const buffer = useRef<DraftBuffer | null>(null);
  if (buffer.current === null) {
    buffer.current = new DraftBuffer({
      store: browserStore(), key, initial, settleMs, onSettle: setSettled,
    });
  }
  const draft = buffer.current;
  useEffect(() => () => draft.dispose(), [draft]);

  const change = useCallback((next: string) => draft.change(next), [draft]);
  return { draft, settled, change };
}
