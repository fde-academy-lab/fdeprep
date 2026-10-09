/**
 * One submission's evaluations, newest first. S15.3, docs/10 section 10.
 *
 * An evaluation is never edited. A re-run after an outage, a regrade under a
 * new judge prompt and a faculty correction each add a row, and this is where
 * faculty read all of them: the judge prompt that graded each, and who on the
 * panel said what, which is what an appeal turns on. The learner reads the
 * newest row only, in one voice, and never reaches this page, because the
 * admin layout refuses learners.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { permits } from "@/lib/admin/guard";
import { evaluationHistory, type HistoryRow, type HistorySeat } from "@/lib/eval/history";
import { BAND_WORD } from "@/lib/policy/bands";
import { currentLearner } from "@/lib/session/current";
import { readableSubmission } from "@/lib/session/records";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/ui/page";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusIcon } from "@/components/ui/status";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: `Submission ${(await props.params).id}` };
}

const STATE: Readonly<Record<HistoryRow["state"], string>> = {
  complete: "Complete",
  partial: "Partial",
  error: "Error",
};

/** The submission's terminal verdict in the words the Submissions screen uses. */
const VERDICT: Readonly<Record<string, string>> = {
  pass: "Passed", fail: "Failed", error: "Error", timeout: "Timed out", rejected: "Rejected",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

/** One seat as faculty read it: the band where it gave one, or what stopped it. */
function seat(s: HistorySeat): string {
  if (s.band) return `${s.panelist} said ${BAND_WORD[s.band]}`;
  const why = s.reason ? ` (${s.reason.replace(/_/g, " ")})` : "";
  return `${s.panelist} ${s.status}${why}`;
}

/** Which judge prompt graded the row, said so that an empty cell is never ambiguous. */
function promptOf(row: HistoryRow): { text: string; recorded: boolean } {
  if (row.judgePrompt) return { text: row.judgePrompt, recorded: true };
  return row.judged
    ? { text: "Not recorded", recorded: false }
    : { text: "None, no model graded it", recorded: false };
}

export default async function SubmissionRecordPage(props: Props) {
  const viewer = await currentLearner();
  const id = Number((await props.params).id);
  if (!permits(viewer.role, "faculty") || !Number.isInteger(id)) notFound();
  // Faculty read their own cohort's record and admins any cohort's
  // (lib/session/records.ts), and anything else is the 404 of a number
  // nobody holds (S15.13).
  if (!(await readableSubmission(viewer, id))) notFound();

  const record = await evaluationHistory(id);
  if (!record) notFound();
  const { submission, evaluations } = record;

  return (
    <>
      <PageHeading
        title={`Submission ${submission.id}`}
        line="Every evaluation this answer has had, newest first. The learner reads the newest one; the rest stay on the record for an appeal." />

      <StatStrip cells={[
        { label: "Learner", value: submission.login },
        { label: "Problem", value: submission.slug },
        { label: "Kind", value: submission.kind.replace("_", " ") },
        { label: "Verdict", value: submission.verdict ? VERDICT[submission.verdict] ?? submission.verdict
                                                       : "Waiting" },
        { label: "Score", value: submission.score === null ? "None" : Math.round(submission.score) },
      ]} />

      {evaluations.length === 0 ? (
        <EmptyState icon={ClipboardList}>
          No evaluation is recorded for this submission yet. One is written when its verdict
          lands, and Ops lists any submission still waiting for its verdict.
        </EmptyState>
      ) : (
        <section aria-label="Evaluations" className="space-y-3">
          <p className="tnum text-text-dim">
            {evaluations.length} {evaluations.length === 1 ? "evaluation" : "evaluations"}
          </p>
          <Table head={
            <Head>
              <Cell head>Graded</Cell>
              <Cell head>State</Cell>
              <Cell head>Verdict</Cell>
              <Cell head>Band</Cell>
              <NumCell head>Score</NumCell>
              <Cell head>Confidence</Cell>
              <Cell head>Judge prompt</Cell>
              <Cell head>The panel</Cell>
              <Cell head>Note</Cell>
            </Head>
          }>
            {evaluations.map((row) => {
              const graded = promptOf(row);
              return (
                <Row key={row.id} className="align-top">
                  <Cell className="whitespace-nowrap text-text-dim">
                    {when(row.createdAt)}
                    {row.newest ? (
                      <div className="text-meta text-text-faint">What the learner reads</div>
                    ) : null}
                  </Cell>
                  <Cell className="text-text-dim">
                    {STATE[row.state]}
                    {row.provisional ? (
                      <div className="text-meta text-text-faint">Score provisional</div>
                    ) : null}
                  </Cell>
                  <Cell>
                    {row.verdict ? (
                      <span className="inline-flex items-center gap-1.5 text-text-dim">
                        <StatusIcon kind={row.verdict === "pass" ? "pass" : "fail"}
                                    label={row.verdict === "pass" ? "Passed" : "Failed"} />
                        <span aria-hidden>{row.verdict === "pass" ? "Passed" : "Failed"}</span>
                      </span>
                    ) : <span className="text-text-faint">None</span>}
                  </Cell>
                  <Cell className="text-text">{row.band ? BAND_WORD[row.band] : "None"}</Cell>
                  <NumCell className="text-text">{row.score}</NumCell>
                  <Cell className="capitalize text-text-dim">{row.confidence}</Cell>
                  <Cell className={graded.recorded ? "font-mono text-meta text-text" : "text-text-faint"}>
                    {graded.text}
                  </Cell>
                  <Cell>
                    {row.seats.map((s) => (
                      <div key={s.panelist} className="whitespace-nowrap text-text-dim">{seat(s)}</div>
                    ))}
                  </Cell>
                  <Cell className="text-meta text-text-dim">
                    {row.override ? <div>Set by {row.override.by}: {row.override.note}</div> : null}
                    {row.disagreement ? <div>The panel disagreed by two bands or more.</div> : null}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        </section>
      )}
    </>
  );
}
