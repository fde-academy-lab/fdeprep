/** Screen S10, the import slice: validate, show the diff, then publish. Admin only. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileCheck } from "lucide-react";
import { permits } from "@/lib/admin/guard";
import { currentLearner } from "@/lib/session/current";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading, SectionHeading } from "@/components/ui/page";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";
import { previewAll } from "./actions";
import PublishButton from "./publish-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Problems" };

export default async function ImportPage() {
  const learner = await currentLearner();
  if (!permits(learner.role, "admin")) notFound();

  const reports = await previewAll();
  const broken = reports.filter((r) => r.errors.length > 0);
  const changing = reports.filter((r) => r.preview && r.preview.action !== "unchanged");

  return (
    <>
      <PageHeading title="Problems"
                   line="Reading every YAML file under problems/. Nothing is written until you publish."
                   action={<PublishButton disabled={changing.length === 0} />} />

      {broken.length > 0 ? (
        <section aria-labelledby="broken">
          <SectionHeading id="broken"
                          title={`${broken.length} ${broken.length === 1 ? "file" : "files"} will not import`} />
          <Table className="mt-4" head={
            <Head>
              <Cell head>File</Cell>
              <NumCell head>Line</NumCell>
              <Cell head>Rule</Cell>
              <Cell head>Message</Cell>
            </Head>
          }>
            {broken.flatMap((report) => report.errors.map((error, index) => (
              <Row key={`${report.file}-${index}`} className="align-top">
                <Cell className="font-mono text-meta text-fail">{report.file}</Cell>
                <NumCell className="text-text-dim">{error.line}</NumCell>
                <Cell className="font-mono text-meta text-text-dim">{error.rule}</Cell>
                <Cell className="text-text">{error.message}</Cell>
              </Row>
            )))}
          </Table>
        </section>
      ) : null}

      <section aria-labelledby="pending">
        <SectionHeading id="pending"
                        title={changing.length === 0 ? "Nothing to publish" : `${changing.length} to publish`} />
        {changing.length === 0 ? (
          <EmptyState icon={FileCheck} className="mt-4">
            Every problem on disk matches the published version. Edit a file under problems/ and
            reload to see the diff.
          </EmptyState>
        ) : (
          <Table className="mt-4" head={
            <Head>
              <Cell head>File</Cell>
              <Cell head>Action</Cell>
              <Cell head>Version</Cell>
              <Cell head>Changes</Cell>
            </Head>
          }>
            {changing.map(({ file, preview }) => (
              <Row key={file} className="align-top">
                <Cell className="font-mono text-meta text-text">{file}</Cell>
                <Cell className="whitespace-nowrap text-text-dim">
                  {preview!.action === "create" ? "new problem" : "new version"}
                </Cell>
                <Cell className="tnum whitespace-nowrap text-text-dim">
                  {preview!.currentVersion ?? "-"} &rarr; {preview!.nextVersion}
                </Cell>
                <Cell className="text-text-dim">
                  <ul className="space-y-0.5">
                    {preview!.changes.map((change) => (
                      <li key={change.field}>
                        <span className="text-text">{change.field}</span>
                        {change.before !== null && (
                          <> <span className="text-fail">{change.before}</span> &rarr;</>
                        )}{" "}
                        <span className="text-pass">{change.after ?? "removed"}</span>
                      </li>
                    ))}
                  </ul>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </section>
    </>
  );
}
