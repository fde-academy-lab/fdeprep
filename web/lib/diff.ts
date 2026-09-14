/**
 * A line diff for the S5 editor's third mode.
 *
 * Small on purpose. The prompts are a few hundred words, the diff is read by a
 * person deciding whether their edit did what they meant, and a dependency
 * would be a dependency to keep current for the rest of the build.
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 1-based line in the original, null on an added line. */
  originalLine: number | null;
  /** 1-based line in the edited text, null on a removed line. */
  editedLine: number | null;
}

/** Longest common subsequence over lines, then walked back into a script. */
export function diffLines(original: string, edited: string): DiffLine[] {
  const a = original.split("\n");
  const b = edited.split("\n");

  const table: number[][] = Array.from({ length: a.length + 1 },
    () => new Array<number>(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]!, originalLine: i + 1, editedLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i]!, originalLine: i + 1, editedLine: null });
      i += 1;
    } else {
      out.push({ kind: "added", text: b[j]!, originalLine: null, editedLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: "removed", text: a[i]!, originalLine: i + 1, editedLine: null });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: "added", text: b[j]!, originalLine: null, editedLine: j + 1 });
    j += 1;
  }
  return out;
}

export function diffCounts(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
  };
}
