/**
 * The draft buffer every workspace types into.
 *
 * A workspace used to hold the answer in React state, so each key re-rendered
 * the whole screen. The buffer keeps the live text out of state and settles a
 * copy after a pause, and these are the properties that make that safe: Run
 * and Submit always read the newest text, nothing that settles late can
 * overwrite a newer replacement, and the draft is saved on every key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftBuffer } from "../components/workspace/draft.ts";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

let settled: string[];
let store: ReturnType<typeof memoryStore>;

function buffer(initial = "") {
  return new DraftBuffer({
    store, key: "draft.7", initial, settleMs: 120, onSettle: (text) => settled.push(text),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  settled = [];
  store = memoryStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("typing", () => {
  it("holds the newest text at once, for Run and Submit to read", () => {
    const draft = buffer("def run():");
    draft.change("def run():\n    pass");
    expect(draft.live).toBe("def run():\n    pass");
    expect(settled).toEqual([]);
  });

  it("settles once after a burst of keys, with the last text", () => {
    const draft = buffer();
    for (const text of ["d", "de", "def", "def r", "def ru", "def run"]) {
      draft.change(text);
      vi.advanceTimersByTime(40);
    }
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(120);
    expect(settled).toEqual(["def run"]);
  });

  it("saves the draft on every key, so a reload loses nothing", () => {
    const draft = buffer();
    draft.change("a");
    draft.change("ab");
    expect(store.data.get("draft.7")).toBe("ab");
  });

  it("keeps working when the browser refuses storage", () => {
    const draft = new DraftBuffer({
      store: { getItem: () => { throw new Error("blocked"); },
               setItem: () => { throw new Error("blocked"); } },
      key: "draft.7", initial: "", settleMs: 120, onSettle: (text) => settled.push(text),
    });
    draft.change("still typing");
    vi.advanceTimersByTime(120);
    expect(draft.live).toBe("still typing");
    expect(settled).toEqual(["still typing"]);
    expect(draft.saved()).toBeNull();
  });
});

describe("a replacement from outside the editor", () => {
  it("settles at once", () => {
    const draft = buffer("stub");
    draft.replace("from the outline", { save: true });
    expect(draft.live).toBe("from the outline");
    expect(settled).toEqual(["from the outline"]);
    expect(store.data.get("draft.7")).toBe("from the outline");
  });

  it("cancels a pending settle, so older typing cannot land on top of it", () => {
    const draft = buffer("stub");
    draft.change("half typed");
    draft.replace("starter code", { save: true });
    vi.advanceTimersByTime(500);
    expect(settled).toEqual(["starter code"]);
    expect(draft.live).toBe("starter code");
  });

  it("can restore a saved draft without writing it back", () => {
    store.data.set("draft.7", "yesterday's work");
    const draft = buffer("stub");
    const saved = draft.saved();
    expect(saved).toBe("yesterday's work");
    store.data.delete("draft.7");
    draft.replace(saved!, { save: false });
    expect(store.data.has("draft.7")).toBe(false);
    expect(draft.live).toBe("yesterday's work");
  });
});

describe("leaving the page", () => {
  it("drops a pending settle rather than firing into an unmounted workspace", () => {
    const draft = buffer();
    draft.change("last key");
    draft.dispose();
    vi.advanceTimersByTime(500);
    expect(settled).toEqual([]);
  });
});
