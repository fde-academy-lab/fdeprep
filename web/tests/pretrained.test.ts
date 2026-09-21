/**
 * Panelist 2. docs/10 section 5.
 *
 * The encoder is injected everywhere below, so none of this needs the 46MB
 * model on disk. That is deliberate: what is worth testing here is which band
 * a set of neighbours produces and when the panelist declines to produce one,
 * and neither of those is a fact about MiniLM. The model itself is measured in
 * `tests/test_embed.py`, which skips when it is absent.
 *
 * The stub maps text to a unit vector over a small keyword basis, so two
 * answers about retries sit near each other and an answer about nothing in the
 * basis sits near nothing.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import type { Embed, EmbedResult } from "../lib/eval/embed.ts";
import { EMBEDDING_MODEL, similarity } from "../lib/eval/embed.ts";
import {
  MIN_SIMILARITY, NEIGHBOURS, nearest, pretrainedPanelist, rememberGraded,
  statusFor, vote, type Neighbour,
} from "../lib/eval/pretrained.ts";
import { runPanel } from "../lib/eval/panel.ts";
import type { Band } from "../lib/policy/bands.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";
import { createSubmission } from "../lib/submissions/create.ts";

const BASIS = ["retry", "budget", "refund", "cache"] as const;

/** A unit vector over the basis, with a fifth slot for text that hits none. */
function stubVector(text: string): number[] {
  const counts = BASIS.map((word) => text.toLowerCase().split(word).length - 1);
  const slots = [...counts, counts.some((c) => c > 0) ? 0 : 1];
  const norm = Math.hypot(...slots);
  return slots.map((c) => c / norm);
}

/** An encoder that records what it was asked to encode. */
function stubEmbed(): Embed & { calls: string[][] } {
  const calls: string[][] = [];
  const encode = async (texts: string[]): Promise<EmbedResult> => {
    calls.push(texts);
    return { ok: true, vectors: texts.map(stubVector) };
  };
  return Object.assign(encode, { calls });
}

function failingEmbed(reason: string): Embed {
  return async () => ({ ok: false, reason });
}

/**
 * Three exemplars that share a topic and differ in what else they mention.
 *
 * Orthogonal exemplars would be easier to reason about and would not resemble
 * a real problem at all: three answers to one question are all about that
 * question, which is why a real pool puts a median of two neighbours above
 * the similarity floor rather than one.
 */
const AUTHORED = `
slug: a-problem
exemplars:
  - { band: strong,   body_md: "retry retry retry retry" }
  - { band: adequate, body_md: "retry budget" }
  - { band: weak,     body_md: "retry cache" }
`;

const INPUT = {
  submissionId: 1, complexity: "C4" as const, artefactType: "design",
  body: "retry retry retry budget", problemSlug: "a-problem",
};

let learner: Awaited<ReturnType<typeof seedLearner>>;
let problemId: number;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner();
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = 'argue-the-eval-plan'");
  problemId = Number(rows[0]!.id);
});

afterAll(async () => {
  await closeDb();
});

function options(encode: Embed, sourceYaml = AUTHORED) {
  return { problemId, sourceYaml, client: db(), embed: encode };
}

async function embeddingCount(): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    "select count(*) from embedding where problem_id = $1", [problemId]);
  return Number(rows[0]!.count);
}

describe("the neighbour pool seeds itself from the authored exemplars", () => {
  it("writes one row per exemplar on first use and none on the second", async () => {
    const encode = stubEmbed();
    const panelist = pretrainedPanelist(options(encode));

    expect(await embeddingCount()).toBe(0);
    await panelist.run(INPUT);
    expect(await embeddingCount()).toBe(3);
    // Three exemplars in one batch, then the answer. Batched because the
    // encoder is a subprocess and three spawns would cost three model loads.
    expect(encode.calls).toEqual([
      ["retry retry retry retry", "retry budget", "retry cache"],
      [INPUT.body],
    ]);

    await panelist.run(INPUT);
    expect(await embeddingCount()).toBe(3);
    // Only the answer the second time. The pool is read from the table, so
    // every submission after the first pays one encode rather than four.
    expect(encode.calls.slice(2)).toEqual([[INPUT.body]]);
  });

  it("records which model produced each vector", async () => {
    await pretrainedPanelist(options(stubEmbed())).run(INPUT);
    const { rows } = await db().query<{ model: string; source: string }>(
      "select model, source from embedding where problem_id = $1", [problemId]);
    expect(rows.every((r) => r.model === EMBEDDING_MODEL)).toBe(true);
    expect(rows.every((r) => r.source === "exemplar")).toBe(true);
  });

  it("ignores vectors from a different model", async () => {
    // Two models' vectors are not comparable at all, so a stale row has to be
    // invisible rather than voting. Without the model filter this seeds a
    // second time and the old row joins the pool.
    await db().query(
      `insert into embedding (problem_id, band, source, vector, model)
       values ($1, 'strong', 'exemplar', $2, 'some-older-model')`,
      [problemId, stubVector("retry")]);

    const encode = stubEmbed();
    await pretrainedPanelist(options(encode)).run(INPUT);
    expect(encode.calls[0]).toHaveLength(3);
    const { rows } = await db().query<{ count: string }>(
      "select count(*) from embedding where problem_id = $1 and model = $2",
      [problemId, EMBEDDING_MODEL]);
    expect(Number(rows[0]!.count)).toBe(3);
  });

  it("skips a problem that has no authored exemplars to compare against", async () => {
    // A code problem is graded by its tests. There is nothing for this
    // panelist to do, which is different from something it failed to do.
    const result = await pretrainedPanelist(
      options(stubEmbed(), "slug: a-code-problem\n")).run(INPUT);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no_graded_pool");
    expect(await embeddingCount()).toBe(0);
  });
});

describe("an encoder that will not run", () => {
  it("reports a missing model as skipped, so nobody is promised a re-run", async () => {
    // A worker image built without the model never encodes anything. Calling
    // that partial would queue a free re-evaluation that never drains.
    const result = await pretrainedPanelist(
      options(failingEmbed("model_missing"))).run(INPUT);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("model_missing");
  });

  it("reports a timeout as unavailable, so the evaluation is partial", async () => {
    const result = await pretrainedPanelist(options(failingEmbed("timeout"))).run(INPUT);
    expect(result.status).toBe("unavailable");
  });

  it("sorts every reason the encoder can return", () => {
    expect(statusFor("model_missing")).toBe("skipped");
    expect(statusFor("dependency_missing")).toBe("skipped");
    expect(statusFor("spawn_failed: ENOENT python3")).toBe("skipped");
    for (const outage of ["timeout", "encode_failed", "exit_1: traceback",
                          "unparsable_response", "bad_request"]) {
      expect(statusFor(outage)).toBe("unavailable");
    }
  });

  it("never lowers a score when it cannot run", async () => {
    // docs/10 section 9. The evaluation goes partial and re-runs for free;
    // what it must not do is treat silence as a weak answer.
    const evaluation = await runPanel(INPUT, [
      { name: "static", async run() {
        return { status: "ran" as const, ms: 0, findings: [],
                 verdict: "pass" as const, scoreContribution: 90 };
      } },
      pretrainedPanelist(options(failingEmbed("timeout"))),
      { name: "llm", async run() {
        return { status: "ran" as const, ms: 0, findings: [], band: "strong" as const };
      } },
    ]);

    expect(evaluation.band).toBe("strong");
    expect(evaluation.state).toBe("partial");
    expect(evaluation.scoreProvisional).toBe(true);
  });
});

describe("which neighbours get a vote", () => {
  const rows = (...bands: Array<[Band, string]>) =>
    bands.map(([band, text]) => ({ band, vector: stubVector(text), source: "exemplar" }));

  it("drops anything the answer does not resemble", () => {
    const pool = rows(["strong", "retry"], ["weak", "cache"]);
    const found = nearest(stubVector("retry"), pool);
    expect(found).toHaveLength(1);
    expect(found[0]!.band).toBe("strong");
    expect(found[0]!.similarity).toBeCloseTo(1, 6);
  });

  it("returns at most three, nearest first", () => {
    const pool = rows(
      ["strong", "retry retry retry retry"], ["adequate", "retry retry retry budget"],
      ["weak", "retry retry budget budget"], ["off_question", "retry budget budget budget"]);
    const found = nearest(stubVector("retry"), pool);
    expect(found).toHaveLength(NEIGHBOURS);
    expect(found.map((n) => n.band)).toEqual(["strong", "adequate", "weak"]);
    expect(found[0]!.similarity).toBeGreaterThan(found[2]!.similarity);
  });

  it("holds the floor at the documented value", () => {
    // A neighbour just under the floor is not a weak signal to be used
    // carefully, it is no evidence at all.
    const just = { band: "strong" as Band, vector: [1, 0, 0, 0, 0], source: "exemplar" };
    const above = nearest([MIN_SIMILARITY + 0.01, 0, 0, 0, 0], [just]);
    const below = nearest([MIN_SIMILARITY - 0.01, 0, 0, 0, 0], [just]);
    expect(above).toHaveLength(1);
    expect(below).toHaveLength(0);
  });

  it("refuses to read a band it does not recognise", () => {
    // A hand-edited row or a band renamed in a later release must not become a
    // vote for a band that no longer exists.
    const junk = [{ band: "excellent", vector: stubVector("retry"), source: "exemplar" }];
    expect(nearest(stubVector("retry"), junk)).toEqual([]);
  });
});

describe("the vote is weighted by how near each neighbour is", () => {
  const at = (band: Band, s: number): Neighbour =>
    ({ band, similarity: s, source: "exemplar" });

  it("lets one close neighbour outvote two distant ones", () => {
    // A plain count returns weak, 2 to 1. The near neighbour is far better
    // evidence than either distant one and counting them equally throws that
    // away, so this is the test that pins the weighting.
    const verdict = vote([at("strong", 0.90), at("weak", 0.30), at("weak", 0.30)]);
    expect(verdict!.band).toBe("strong");
    expect(verdict!.confidence).toBeCloseTo(0.6, 6);
  });

  it("returns nothing when no neighbour cleared the floor", () => {
    expect(vote([])).toBeNull();
  });

  it("sums the neighbours that agree", () => {
    const verdict = vote([at("weak", 0.40), at("weak", 0.40), at("strong", 0.70)]);
    expect(verdict!.band).toBe("weak");
  });
});

describe("what the panelist says about its own evidence", () => {
  it("names a pool that is still only the authored set", async () => {
    const result = await pretrainedPanelist(options(stubEmbed())).run(INPUT);
    expect(result.status).toBe("ran");
    expect(result.band).toBe("strong");
    expect(result.findings.map((f) => f.code)).toContain("thin_pool");
    expect(result.findings.every((f) => f.severity === "informational")).toBe(true);
  });

  it("stops naming it once a cohort's answers are in the pool", async () => {
    await pretrainedPanelist(options(stubEmbed())).run(INPUT);
    await db().query(
      `insert into embedding (problem_id, band, source, vector, model)
       values ($1, 'strong', 'submission', $2, $3)`,
      [problemId, stubVector("retry retry"), EMBEDDING_MODEL]);

    const result = await pretrainedPanelist(options(stubEmbed())).run(INPUT);
    expect(result.findings.map((f) => f.code)).not.toContain("thin_pool");
  });

  it("says so when the nearest answers disagree with each other", async () => {
    const result = await pretrainedPanelist(options(stubEmbed())).run({
      ...INPUT, body: "retry budget cache",
    });
    // Equidistant from three exemplars in three different bands, which is the
    // honest answer that this one is hard to place.
    expect(result.findings.map((f) => f.code)).toContain("split_neighbours");
  });

  it("declines rather than guessing when the answer resembles nothing", async () => {
    const result = await pretrainedPanelist(options(stubEmbed())).run({
      ...INPUT, body: "an answer about something else entirely",
    });
    expect(result.status).toBe("ran");
    expect(result.band).toBeUndefined();
    expect(result.findings.map((f) => f.code)).toEqual(["no_close_neighbour"]);
  });

  it("carries no panelist name into what a learner reads", async () => {
    const result = await pretrainedPanelist(options(stubEmbed())).run(INPUT);
    const prose = result.findings.map((f) => f.detail).join(" ").toLowerCase();
    for (const leak of ["panelist", "embedding", "vector", "neighbour", "cosine"]) {
      expect(prose).not.toContain(leak);
    }
  });
});

describe("how much evidence a band needs rises with the level", () => {
  /** A pool holding one neighbour the answer is near and one it is not. */
  async function oneNeighbour(): Promise<void> {
    await db().query(
      `insert into embedding (problem_id, band, source, vector, model)
       values ($1, 'strong', 'exemplar', $2, $4), ($1, 'weak', 'exemplar', $3, $4)`,
      [problemId, stubVector("retry"), stubVector("cache"), EMBEDDING_MODEL]);
  }

  it("declines to band a C4 answer that only one graded answer is near", async () => {
    // Measured across 11 problems: whenever exactly one neighbour clears the
    // floor, the weighted vote reports confidence 1.00, because that one
    // neighbour holds all the weight. So `split_neighbours` cannot fire in
    // precisely the case where the evidence is thinnest. At C4 the band is
    // most of the grade, so a band resting on one neighbour is withheld.
    await oneNeighbour();
    const result = await pretrainedPanelist(options(stubEmbed())).run(INPUT);

    expect(result.status).toBe("ran");
    expect(result.band).toBeUndefined();
    expect(result.findings.map((f) => f.code)).toContain("thin_evidence");
  });

  it("bands the same answer at C2, where the tests already decided", async () => {
    // A code problem is graded by its battery. One neighbour is a garnish on
    // a verdict that does not depend on it, so withholding it buys nothing.
    await oneNeighbour();
    const result = await pretrainedPanelist(options(stubEmbed()))
      .run({ ...INPUT, complexity: "C2", artefactType: "code" });

    expect(result.band).toBe("strong");
    expect(result.findings.map((f) => f.code)).not.toContain("thin_evidence");
  });

  it("bands a C4 answer once two graded answers are near it", async () => {
    // Two is what a fresh three-exemplar pool actually supplies: measured
    // median 2 across every authored problem. A bar of three would silence
    // this panelist until a cohort filled the pool rather than restrain it.
    await db().query(
      `insert into embedding (problem_id, band, source, vector, model)
       values ($1, 'strong', 'exemplar', $2, $4), ($1, 'strong', 'exemplar', $3, $4)`,
      [problemId, stubVector("retry"), stubVector("retry retry"), EMBEDDING_MODEL]);

    const result = await pretrainedPanelist(options(stubEmbed())).run(INPUT);
    expect(result.band).toBe("strong");
    expect(result.findings.map((f) => f.code)).not.toContain("thin_evidence");
  });

  it("never lowers a grade when it withholds a band", async () => {
    // Withholding is not a weak band. The panel has to read it as silence.
    await oneNeighbour();
    const evaluation = await runPanel(INPUT, [
      { name: "static", async run() {
        return { status: "ran" as const, ms: 0, findings: [],
                 verdict: "pass" as const, scoreContribution: 90 };
      } },
      pretrainedPanelist(options(stubEmbed())),
      { name: "llm", async run() {
        return { status: "ran" as const, ms: 0, findings: [], band: "strong" as const };
      } },
    ]);

    expect(evaluation.band).toBe("strong");
    expect(evaluation.disagreement).toBeNull();
    expect(evaluation.state).toBe("complete");
  });
});

describe("the pool learns from the cohort", () => {
  let nextLearner = 2;

  /**
   * One submission from a learner who has not submitted before.
   *
   * A new learner each time rather than one submitting repeatedly, because
   * this problem is Extreme and the cap is one submit per problem per day.
   * Which is the shape the pool grows in anyway: a cohort, not a repeat.
   */
  async function submissionId(body: string): Promise<number> {
    const githubId = nextLearner;
    nextLearner += 1;
    const enrolled = await seedLearner({ githubId, cohortId: learner.cohortId });
    const submission = await createSubmission({
      enrolmentId: enrolled.enrolmentId, cohortId: enrolled.cohortId,
      problemId, kind: "submit", body,
    });
    return submission.id;
  }

  it("adds one row per graded submission", async () => {
    const id = await submissionId("retry and budget");
    const stored = await rememberGraded(db(), {
      problemId, submissionId: id, band: "adequate", body: "retry and budget",
    }, stubEmbed());

    expect(stored).toBe(true);
    const { rows } = await db().query<{ band: string; source: string }>(
      "select band, source from embedding where submission_id = $1", [id]);
    expect(rows).toEqual([{ band: "adequate", source: "submission" }]);
  });

  it("replaces rather than duplicating when a submission is graded again", async () => {
    // A learner graded twice would otherwise count twice in everybody else's
    // nearest neighbours, and the second grade is the one that stands.
    const id = await submissionId("retry");
    await rememberGraded(db(), { problemId, submissionId: id, band: "weak", body: "retry" },
      stubEmbed());
    await rememberGraded(db(), { problemId, submissionId: id, band: "strong", body: "retry" },
      stubEmbed());

    const { rows } = await db().query<{ band: string }>(
      "select band from embedding where submission_id = $1", [id]);
    expect(rows).toEqual([{ band: "strong" }]);
  });

  it("stores nothing for a submission the panel could not band", async () => {
    const id = await submissionId("retry");
    const encode = stubEmbed();
    expect(await rememberGraded(db(),
      { problemId, submissionId: id, band: null, body: "retry" }, encode)).toBe(false);
    // Not even encoded: an ungraded answer is not evidence about anything, so
    // paying a model load for it would be waste as well as wrong.
    expect(encode.calls).toEqual([]);
    expect(await embeddingCount()).toBe(0);
  });

  it("stores nothing when the encoder will not run", async () => {
    const id = await submissionId("retry");
    expect(await rememberGraded(db(),
      { problemId, submissionId: id, band: "strong", body: "retry" },
      failingEmbed("model_missing"))).toBe(false);
    expect(await embeddingCount()).toBe(0);
  });

  it("lets graded answers outweigh the authored exemplars", async () => {
    // This is the whole claim of the module: no training run, and the band a
    // problem hands out still moves as a cohort answers it. The authored set
    // calls this text strong; three graded answers saying otherwise win.
    const encode = stubEmbed();
    const before = await pretrainedPanelist(options(encode)).run(INPUT);
    expect(before.band).toBe("strong");

    for (const [index, band] of (["weak", "weak", "weak"] as Band[]).entries()) {
      const id = await submissionId(`a cohort answer ${index}`);
      await rememberGraded(db(),
        { problemId, submissionId: id, band, body: INPUT.body }, encode);
    }

    const after = await pretrainedPanelist(options(encode)).run(INPUT);
    expect(after.band).toBe("weak");
    expect(after.findings.map((f) => f.code)).not.toContain("thin_pool");
  });
});

describe("similarity on the vectors the encoder produces", () => {
  it("is the dot product, because they arrive normalised", () => {
    expect(similarity(stubVector("retry"), stubVector("retry"))).toBeCloseTo(1, 6);
    expect(similarity(stubVector("retry"), stubVector("cache"))).toBeCloseTo(0, 6);
  });

  it("refuses to compare vectors of different lengths", () => {
    // Two models' vectors are not comparable. Returning zero rather than
    // reading off the end keeps a mixed pool from producing a confident band.
    expect(similarity([1, 0, 0], [1, 0])).toBe(0);
  });
});
