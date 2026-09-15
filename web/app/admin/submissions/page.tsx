/** S10 Submissions: filterable by learner, problem, verdict and date, with a link to every trace. */
import Link from "next/link";
import { browseSubmissions } from "@/lib/admin/submissions";
import { relativeDay } from "@/lib/progress/summary";

export const dynamic = "force-dynamic";

const VERDICTS = ["all", "open", "pass", "fail", "error", "timeout", "rejected", "cancelled"];

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) =>
  (Array.isArray(params[key]) ? params[key][0] : params[key]) ?? "";

export default async function SubmissionsPage({ searchParams }: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const page = await browseSubmissions({
    login: one(params, "login") || undefined,
    slug: one(params, "slug") || undefined,
    verdict: one(params, "verdict") || undefined,
    since: one(params, "since") || undefined,
    page: Number(one(params, "page")) || 1,
  });

  return (
    <main className="px-4 py-4">
      <h1 className="mb-3">Submissions</h1>

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col">
          <span className="text-text-dim">Learner</span>
          <input name="login" defaultValue={one(params, "login")} placeholder="github login"
                 className="rounded border border-border bg-bg px-2 py-1" />
        </label>
        <label className="flex flex-col">
          <span className="text-text-dim">Problem</span>
          <input name="slug" defaultValue={one(params, "slug")} placeholder="slug"
                 className="rounded border border-border bg-bg px-2 py-1" />
        </label>
        <label className="flex flex-col">
          <span className="text-text-dim">Verdict</span>
          <select name="verdict" defaultValue={one(params, "verdict") || "all"}
                  className="rounded border border-border bg-bg px-2 py-1">
            {VERDICTS.map((verdict) => <option key={verdict} value={verdict}>{verdict}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-text-dim">Since</span>
          <input name="since" type="date" defaultValue={one(params, "since")}
                 className="rounded border border-border bg-bg px-2 py-1" />
        </label>
        <button type="submit" className="rounded border border-border px-3 py-1
                                         hover:border-accent">Filter</button>
      </form>

      <p className="tnum mb-2 text-text-dim">{page.total} submissions</p>

      <table className="w-full text-left">
        <thead>
          <tr className="text-text-dim">
            {["When", "Learner", "Problem", "Kind", "Verdict", "Score", "Trace"].map((head) => (
              <th key={head} scope="col" className="py-1 pr-4 font-normal">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2 pr-4 text-text-dim">{relativeDay(row.queuedAt)}</td>
              <td className="py-2 pr-4">{row.login}</td>
              <td className="py-2 pr-4">{row.slug}</td>
              <td className="py-2 pr-4 text-text-dim">{row.kind}</td>
              <td className={`py-2 pr-4 ${
                row.verdict === "pass" ? "text-pass"
                  : row.verdict === null ? "text-text-faint" : "text-warn"}`}>
                {row.verdict ?? row.status}
              </td>
              <td className="tnum py-2 pr-4">{row.score ?? "--"}</td>
              <td className="py-2">
                {row.hasTrace ? (
                  <Link href={`/traces/${row.id}`} className="text-accent">trace</Link>
                ) : <span className="text-text-faint">--</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {page.rows.length === 0 ? (
        <p className="py-4 text-text-dim">
          No submissions match. Clear a filter, or widen the date.
        </p>
      ) : null}
    </main>
  );
}
