"""Lay the catalogue out on the 30-day path.

Run from the repository root after adding, moving or re-tiering problems:

    python -m tools.storyline          # rewrite each problem's day: line
    python -m tools.storyline --check  # exit 1 when a day would change

The path walks the four stages in order (web/lib/problems/vocabulary.ts).
Each stage gets a run of days in proportion to how many problems it holds,
every day gets at least MIN_PER_DAY and at most MAX_PER_DAY, and inside a
stage the problems run Easy to Extreme. Two problems at the same tier keep
the order their old days gave them, so an author's sequence survives a
re-run. The forward deployed stage keeps its old order outright, because each
build runs its four stages on consecutive days.

A problem marked `drill: true` has no day and is left out: it sits in its
chapter off the path (docs/04 section 2.0, amended 8 October 2026). When the
path problems no longer fit, mark the most repetitive ones as drills.

The storyline test in web/tests/storyline.test.ts holds the same limits.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PROBLEMS = ROOT / "problems"
DAYS = 30
MIN_PER_DAY = 3
MAX_PER_DAY = 5

# Mirrors STAGES in web/lib/problems/vocabulary.ts, which a test compares.
STAGES: list[tuple[str, list[str]]] = [
    ("foundations", ["loop", "tools", "harness"]),
    ("builder", ["context", "memory", "orchestration"]),
    ("production", ["guardrails", "human-in-the-loop", "evals", "observability"]),
    ("fde", ["agentic-pdlc", "agentic-sdlc", "builds", "fde-practice"]),
]
KEEP_ORDER = {"fde"}
TIERS = ["easy", "medium", "hard", "extreme"]


def catalogue() -> list[dict]:
    rows = []
    for path in sorted(PROBLEMS.glob("*/*.yaml")):
        if path.parent.name == "_fixtures":
            continue
        raw = yaml.safe_load(path.read_text())
        if raw.get("drill"):
            continue
        rows.append({"path": path, "slug": raw["slug"], "track": raw["track"],
                     "difficulty": raw["difficulty"], "day": int(raw.get("day") or 0)})
    return rows


def split_days(counts: list[int]) -> list[int]:
    """Days per stage: each starts at the fewest days its problems fit in, and
    each spare day goes to the stage with the most problems per day, never
    past the point where a day would fall below MIN_PER_DAY."""
    days = [max(1, -(-c // MAX_PER_DAY)) for c in counts]
    while sum(days) < DAYS:
        room = [k for k in range(len(days)) if counts[k] >= MIN_PER_DAY * (days[k] + 1)]
        if not room:
            break
        days[max(room, key=lambda k: counts[k] / days[k])] += 1
    if sum(days) != DAYS:
        raise SystemExit(f"{sum(counts)} problems on the path in stages of {counts} need "
                         f"{sum(days)} days at {MIN_PER_DAY} to {MAX_PER_DAY} a day, and the path "
                         f"has {DAYS}. Mark problems in the most crowded stage drill: true "
                         "(docs/04 section 2.0).")
    return days


def plan() -> dict[Path, int]:
    rows = catalogue()
    stage_of = {track: stage for stage, tracks in STAGES for track in tracks}
    unknown = sorted({r["track"] for r in rows} - set(stage_of))
    if unknown:
        raise SystemExit(f"no stage for chapters {unknown}")
    grouped = [[r for r in rows if stage_of[r["track"]] == stage] for stage, _ in STAGES]
    spans = split_days([len(g) for g in grouped])

    out: dict[Path, int] = {}
    first = 1
    for (stage, tracks), group, span in zip(STAGES, grouped, spans):
        if stage in KEEP_ORDER:
            group.sort(key=lambda r: (r["day"], r["slug"]))
        else:
            group.sort(key=lambda r: (TIERS.index(r["difficulty"]), r["day"],
                                      tracks.index(r["track"]), r["slug"]))
        base, extra = divmod(len(group), span)
        if stage in KEEP_ORDER:
            at = 0
            for offset in range(span):
                take = base + (1 if offset < extra else 0)
                for r in group[at:at + take]:
                    out[r["path"]] = first + offset
                at += take
        else:
            # One problem per chapter a day where the stage allows it, each
            # chapter in its own order, so a ladder inside a chapter lands on
            # consecutive days rather than two rungs on one day in slug order.
            rank = {id(r): i for i, r in enumerate(group)}
            queues = {t: [r for r in group if r["track"] == t] for t in tracks}
            for offset in range(span):
                take = base + (1 if offset < extra else 0)
                used: set[str] = set()
                for _ in range(take):
                    open_ = [t for t in tracks if queues[t]]
                    fresh = [t for t in open_ if t not in used] or open_
                    pick = min(fresh, key=lambda t: rank[id(queues[t][0])])
                    out[queues[pick].pop(0)["path"]] = first + offset
                    used.add(pick)
        first += span
    return out


def main(argv: list[str]) -> int:
    check = "--check" in argv
    changed = 0
    for path, day in plan().items():
        text = path.read_text()
        new = re.sub(r"^day: .*$", f"day: {day}", text, count=1, flags=re.M)
        if new != text:
            changed += 1
            if not check:
                path.write_text(new)
    if check and changed:
        print(f"{changed} problems are off the path; run python -m tools.storyline")
        return 1
    print(f"{changed} days {'would change' if check else 'rewritten'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
