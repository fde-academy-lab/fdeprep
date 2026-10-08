/** The fixed competency vocabulary from docs/00 section 3.3. */
export const COMPETENCIES = [
  "agent-loop", "tool-schema-design", "tool-error-handling", "state-and-memory",
  "retrieval", "context-assembly", "evaluation-design", "failure-mode-analysis",
  "prompt-construction", "prompt-hardening", "cost-and-latency", "system-design",
  "client-communication",
] as const;

export type Competency = (typeof COMPETENCIES)[number];

/**
 * The chapters. Each is one concept of agent engineering, and every problem
 * sits in exactly one. The field is still called `track` in YAML and in the
 * database, so the column and every query keep their name; the learner reads
 * "chapter". Replaced the eleven topic tracks on 1 October 2026.
 */
export const TRACKS = [
  "loop", "tools", "harness",
  "context", "memory", "orchestration",
  "guardrails", "human-in-the-loop", "evals", "observability",
  "agentic-pdlc", "agentic-sdlc", "builds", "fde-practice",
] as const;

export type Track = (typeof TRACKS)[number];

/**
 * The zero-to-hero path: four stages, each a set of chapters a learner starts
 * in that order. A chapter still runs Easy to Extreme inside itself; the stage
 * is where it begins. This grouping is the author's construction, not
 * docs/00's, and it drives the journey map rather than the roadmap's own
 * ordering.
 */
export const STAGES = [
  { id: "foundations", name: "Foundations",
    blurb: "Run a loop that ends, give it tools it can use, and wrap it in a harness that survives failure.",
    tracks: ["loop", "tools", "harness"] },
  { id: "builder", name: "Builder",
    blurb: "Decide what the model sees, what it remembers, and how several agents share the work.",
    tracks: ["context", "memory", "orchestration"] },
  { id: "production", name: "Production",
    blurb: "Limit what it can touch, put people where they count, measure it, and see inside every run.",
    tracks: ["guardrails", "human-in-the-loop", "evals", "observability"] },
  { id: "fde", name: "Forward deployed",
    blurb: "Frame the product, run the delivery with agents, and ship whole systems in front of a client.",
    tracks: ["agentic-pdlc", "agentic-sdlc", "builds", "fde-practice"] },
] as const satisfies ReadonlyArray<{ id: string; name: string; blurb: string;
                                     tracks: readonly Track[] }>;

export const TRACK_NAMES: Readonly<Record<Track, string>> = {
  "loop": "Loop engineering",
  "tools": "Tool design",
  "harness": "Harness engineering",
  "context": "Context engineering",
  "memory": "Memory architecture",
  "orchestration": "Orchestration patterns",
  "guardrails": "Guardrails and permissions",
  "human-in-the-loop": "Human in the loop",
  "evals": "Evals for agents",
  "observability": "Observability and tracing",
  "agentic-pdlc": "Agentic PDLC",
  "agentic-sdlc": "Agentic SDLC (AI-DLC)",
  "builds": "End-to-end builds",
  "fde-practice": "Client delivery",
};

/** What each chapter is for, in one sentence a newcomer can read. */
export const TRACK_BLURBS: Readonly<Record<Track, string>> = {
  "loop": "When a task needs a loop at all, and how a loop reasons, acts, observes and stops.",
  "tools": "Tools a model can read, call correctly and recover from, with and without a framework.",
  "harness": "Everything around the loop that keeps it alive: retries, fallbacks, sandboxes, limits and costs.",
  "context": "What goes in the window, what gets retrieved, and what to cut when the window fills.",
  "memory": "What an agent keeps between turns and sessions, how it finds it again, and what it must forget.",
  "orchestration": "One agent or several, who hands work to whom, and when a crew loses to one good agent.",
  "guardrails": "What each task may read, write and run, what gets filtered, and how far a failure can reach.",
  "human-in-the-loop": "Where a person approves, watches or steps back, and how to interrupt without killing autonomy.",
  "evals": "How you know the agent works: outcomes and trajectories, golden sets, judges and regressions.",
  "observability": "A trace of every step, call and token, so a failed run can be explained and fed back.",
  "agentic-pdlc": "Taking a client's idea from a vague ask to a product worth funding, with agents doing the legwork and people making the calls.",
  "agentic-sdlc": "Running delivery with AI agents: AWS's AI-DLC with its bolts and units of work, and BMAD's AI-driven development (AiDD), with the human checkpoints each one needs.",
  "builds": "Whole systems built in stages, where every chapter's lesson has to hold at once.",
  "fde-practice": "The client side of the work: framing, contracts, pushback and the case for expansion.",
};

/**
 * The topics inside each chapter. A problem names one in `concept.topic`, and
 * the validator refuses any other, so a chapter's page groups cleanly and no
 * topic is spelled two ways.
 */
export const CHAPTER_TOPICS: Readonly<Record<Track, readonly string[]>> = {
  "loop": ["Do you need a loop?", "Reason, act, observe", "Stopping", "Iteration budgets",
           "Loops that never end"],
  "tools": ["Names and descriptions", "Strict input schemas", "Errors the model can fix",
            "Fewer, better tools", "Frameworks"],
  "harness": ["Retries and fallbacks", "Sandboxed execution", "Rate limits and cost caps",
              "Graceful degradation"],
  "context": ["In the window or retrieved", "Compression and summaries", "Context rot",
              "Long context", "Recency against relevance"],
  "memory": ["Short-term and long-term", "What to persist", "Retrieval strategies",
             "Memory writes"],
  "orchestration": ["One agent or many", "Handoffs and routing", "Parallel or sequential",
                    "When one agent wins"],
  "guardrails": ["Scoped tool access", "Read, write and execute", "Input and output filtering",
                 "Blast radius"],
  "human-in-the-loop": ["In, on or out of the loop", "Approval gates", "Confidence thresholds",
                        "Async or blocking review", "Interrupts"],
  "evals": ["Trajectory and outcome", "Golden sets from failures", "LLM judges",
            "Regression testing"],
  "observability": ["Trace every step", "Traces for debugging", "Cost and latency per run",
                    "Failures into evals"],
  "agentic-pdlc": ["Problem framing", "Discovery and evidence", "POC, MVP, production",
                   "Measuring value", "Choosing a method"],
  "agentic-sdlc": ["Inception and mob elaboration", "Units of work and bolts",
                   "Specs before code", "Planning paths in BMAD", "Approval gates and evidence",
                   "Operations with context"],
  "builds": ["Analytics agent", "Extraction pilot", "Incident investigator", "Support copilot"],
  "fde-practice": ["Integration contracts", "Pushback and scoping", "Pilot to production"],
};

/** The storyline: every catalogue problem belongs to one day of a learner's first 30 as an FDE. */
export const STORYLINE_DAYS = 30;

export const DIFFICULTIES = ["easy", "medium", "hard", "extreme"] as const;
export const ARTEFACT_TYPES = ["code", "prompt", "design"] as const;
export const VISIBILITIES = ["public", "hidden", "adversarial"] as const;
