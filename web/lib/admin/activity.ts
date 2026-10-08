/**
 * When an enrolment last practised: a run or a submit, a voice answer, or a
 * rehearsal sitting, whichever came last.
 *
 * One fragment, so the roster and the cohort overview read last activity the
 * same way and cannot disagree about who has gone quiet. It used to read
 * submissions alone, and a learner with forty voice answers read "never".
 * Expects the enrolment aliased `e`.
 */
export const lastActivitySql = `greatest(
  (select max(s.queued_at) from submission s
     join attempt a on a.id = s.attempt_id
    where a.enrolment_id = e.id),
  (select max(v.started_at) from voice_session v where v.enrolment_id = e.id),
  (select max(r.started_at) from rehearsal r where r.enrolment_id = e.id))`;
