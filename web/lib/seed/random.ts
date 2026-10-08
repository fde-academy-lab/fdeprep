/**
 * A seeded random source, so two runs of the seed plan the same rows.
 *
 * mulberry32: 32 bits of state, good enough to spread a cohort's activity and
 * nowhere near good enough for anything that needs to be unpredictable. It
 * never decides anything about security; it decides who works on a Tuesday.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [low, high], both ends included. */
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error("pick from an empty list");
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** One key of `weights`, chosen in proportion to its weight. */
  weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
    const entries = Object.entries(weights) as Array<[K, number]>;
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [key, weight] of entries) {
      roll -= weight;
      if (roll < 0) return key;
    }
    return entries[entries.length - 1]![0];
  }
}
