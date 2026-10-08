/**
 * The resume's limits and its rule, shared by the server and the box a
 * learner pastes into. docs/07 section 9, as amended for S14.2.
 *
 * Browser-safe: no imports.
 */

/** At most this many characters are read. */
export const RESUME_MAX_CHARS = 12_000;

/** The first sentence of the consent screen's resume term, repeated where the
 *  learner pastes, so the rule is read where it applies. */
export const RESUME_RULE =
  "In interview mode you can paste your resume so the interviewer can ask about it.";
