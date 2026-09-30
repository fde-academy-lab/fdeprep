/** The fixed competency vocabulary from docs/00 section 3.3. */
export const COMPETENCIES = [
  "agent-loop", "tool-schema-design", "tool-error-handling", "state-and-memory",
  "retrieval", "context-assembly", "evaluation-design", "failure-mode-analysis",
  "prompt-construction", "prompt-hardening", "cost-and-latency", "system-design",
  "client-communication",
] as const;

export type Competency = (typeof COMPETENCIES)[number];

export const TRACKS = [
  "agent-loop", "tool-creation", "memory", "rag", "evals", "prompt",
  // Added 29 September 2026 with the catalogue expansion. Each maps onto
  // existing competencies; the competency vocabulary did not grow.
  "structured-output", "guardrails", "production", "fde-practice", "builds",
] as const;

export type Track = (typeof TRACKS)[number];

/**
 * The zero-to-hero path: four stages, each a set of tracks a learner starts in
 * that order. A track still runs Easy to Extreme inside itself; the stage is
 * where it begins. This grouping is the author's construction, not docs/00's,
 * and it drives the journey map rather than the roadmap's own ordering.
 */
export const STAGES = [
  { id: "foundations", name: "Foundations",
    blurb: "Talk to a model, parse what it says, and run a loop that ends.",
    tracks: ["structured-output", "prompt", "agent-loop", "tool-creation"] },
  { id: "builder", name: "Builder",
    blurb: "Ground answers in documents and keep state across a conversation.",
    tracks: ["rag", "memory"] },
  { id: "production", name: "Production",
    blurb: "Make it safe, measure it, and keep it cheap and fast under load.",
    tracks: ["guardrails", "evals", "production"] },
  { id: "fde", name: "Forward deployed",
    blurb: "Scope, defend and ship whole systems in front of a client.",
    tracks: ["fde-practice", "builds"] },
] as const satisfies ReadonlyArray<{ id: string; name: string; blurb: string;
                                     tracks: readonly Track[] }>;

export const TRACK_NAMES: Readonly<Record<Track, string>> = {
  "structured-output": "Structured output",
  "prompt": "Prompt engineering",
  "agent-loop": "Agent loops",
  "tool-creation": "Tools",
  "rag": "Retrieval",
  "memory": "Memory and state",
  "guardrails": "Guardrails",
  "evals": "Evals and observability",
  "production": "Production operations",
  "fde-practice": "Client delivery",
  "builds": "Capstone builds",
};

export const DIFFICULTIES = ["easy", "medium", "hard", "extreme"] as const;
export const ARTEFACT_TYPES = ["code", "prompt", "design"] as const;
export const VISIBILITIES = ["public", "hidden", "adversarial"] as const;
