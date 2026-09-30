/**
 * Ranking for the command palette, kept pure so it can be tested without a
 * browser.
 *
 * Every word the learner types has to appear somewhere in the problem's title,
 * track or difficulty. Among the matches, a title that starts with the query
 * beats one where a title word starts with it, which beats a match anywhere.
 * Ties keep catalogue order, so the list does not reshuffle between keystrokes.
 */
export interface Searchable {
  title: string;
  track: string;
  difficulty: string;
  artefactType: string;
}

function haystack(item: Searchable): string {
  return `${item.title} ${item.track.replace(/-/g, " ")} ${item.difficulty} ${item.artefactType}`
    .toLowerCase();
}

export function score(item: Searchable, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const words = q.split(/\s+/);
  const text = haystack(item);
  if (!words.every((word) => text.includes(word))) return 0;
  const title = item.title.toLowerCase();
  if (title.startsWith(q)) return 4;
  if (title.split(/[^a-z0-9]+/).some((word) => word.startsWith(words[0]!))) return 3;
  if (title.includes(q)) return 2;
  return 1;
}

export function search<T extends Searchable>(items: readonly T[], query: string, limit = 12): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
