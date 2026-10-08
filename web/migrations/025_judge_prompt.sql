-- Which judge prompt graded an evaluation. S15.3, docs/10 section 10.
--
-- The judge names the file in judge/prompts/ whose wording produced a grade,
-- and eval/ writes it here on every new evaluation. An appeal can then say
-- which wording scored an answer, and a regrade can select the rows a retired
-- prompt graded. Empty where no judge prompt graded the answer: a code
-- submission, an answer a cheaper check stopped, and every row written before
-- this column existed.
--
-- Additive only, per the standing rule that a migration stays backward
-- compatible for one release: a nullable column with no default, so the
-- previous release's inserts, which do not name it, still succeed and leave it
-- empty. Rows already written are left as they are, because the table is
-- append-only and a value filled in now would be a guess recorded as a fact.

alter table evaluation add column if not exists judge_prompt text;
