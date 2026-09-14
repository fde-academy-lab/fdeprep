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
] as const;

export const DIFFICULTIES = ["easy", "medium", "hard", "extreme"] as const;
export const ARTEFACT_TYPES = ["code", "prompt", "design"] as const;
export const VISIBILITIES = ["public", "hidden", "adversarial"] as const;
