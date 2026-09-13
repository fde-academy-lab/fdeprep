/** Screen S10, the import slice: validate, show the diff, then publish. */
import { previewAll } from "./actions";
import PublishButton from "./publish-button";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const reports = await previewAll();
  const broken = reports.filter((r) => r.errors.length > 0);
  const changing = reports.filter((r) => r.preview && r.preview.action !== "unchanged");

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-xl font-semibold">Import problems</h1>
      <p className="mt-1 text-text-dim">
        Reading every YAML file under problems/. Nothing is written until you publish.
      </p>

      {broken.length > 0 && (
        <section className="mt-6 border border-fail/40 bg-surface p-4">
          <h2 className="text-fail">{broken.length} file{broken.length === 1 ? "" : "s"} will not import</h2>
          <ul className="mt-2 space-y-1 font-mono text-text-dim">
            {broken.flatMap((report) =>
              report.errors.map((error, index) => (
                <li key={`${report.file}-${index}`}>
                  <span className="text-fail">{report.file}:{error.line}</span>{" "}
                  {error.rule}: {error.message}
                </li>
              )))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-xs uppercase tracking-wide text-text-faint">
          {changing.length === 0 ? "Nothing to publish" : `${changing.length} to publish`}
        </h2>

        {changing.length === 0 ? (
          <p className="mt-2 text-text-dim">
            Every problem on disk matches the published version. Edit a file under problems/
            and reload to see the diff.
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-left">
            <thead className="text-xs uppercase tracking-wide text-text-faint">
              <tr className="border-b border-border">
                <th scope="col" className="py-2">File</th>
                <th scope="col" className="py-2">Action</th>
                <th scope="col" className="py-2">Version</th>
                <th scope="col" className="py-2">Changes</th>
              </tr>
            </thead>
            <tbody>
              {changing.map(({ file, preview }) => (
                <tr key={file} className="border-b border-border align-top">
                  <td className="py-2 font-mono">{file}</td>
                  <td className="py-2 text-text-dim">
                    {preview!.action === "create" ? "new problem" : "new version"}
                  </td>
                  <td className="tnum py-2 text-text-dim">
                    {preview!.currentVersion ?? "-"} &rarr; {preview!.nextVersion}
                  </td>
                  <td className="py-2 text-text-dim">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <PublishButton disabled={changing.length === 0} />
    </main>
  );
}
