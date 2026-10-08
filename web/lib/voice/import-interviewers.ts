/**
 * The interviewers from YAML into the database. docs/07 section 2a.
 *
 * The counterpart of import.ts for voice-interviewers/, run by the same
 * operator action before the questions, because a question names its
 * interviewers and the picker filters on them.
 *
 * The whole directory is one import. Every file is validated first, against
 * the slugs of the others so a panel can only name members that exist, and
 * nothing is written unless all of them pass. Then each is upserted on its
 * slug, and an interviewer the directory no longer holds is retired, never
 * deleted, because a past session names it and its debrief still says who
 * asked.
 *
 * voice_spoken_line is left alone. A line cached under the old words is keyed
 * on their hash, so it is never served for new ones, and it may still be
 * served for a question that has not changed.
 */
import path from "node:path";
import { parse } from "yaml";
import { inTransaction } from "../db/pool.ts";
import { validateInterviewerYaml } from "./validate-interviewer.ts";

export class InterviewerImportRejected extends Error {}

type File = {
  slug: string; name: string; role: string; listens_for: string[]; opening_line: string;
  follow_up_style: string; stress_probes: string[]; cadence: string[];
  voice?: { id: string; engine: string; language: string }; members?: string[];
};

/** Validate and publish every interviewer, retiring any slug not among them.
 *  Returns the number published. */
export async function importInterviewers(
  files: ReadonlyArray<{ source: string; file: string }>,
): Promise<number> {
  const known = new Set(files.map(({ file }) => path.basename(file).replace(/\.ya?ml$/, "")));
  for (const { source, file } of files) {
    const report = validateInterviewerYaml(source, file, { known });
    if (!report.ok) {
      const first = report.errors[0]!;
      throw new InterviewerImportRejected(
        `${file}:${first.line} ${first.rule}: ${first.message}` +
        (report.errors.length > 1 ? ` (and ${report.errors.length - 1} more)` : ""));
    }
  }

  return inTransaction(async (client) => {
    const slugs: string[] = [];
    for (const { source } of files) {
      const person = parse(source) as File;
      slugs.push(person.slug);
      await client.query(
        `insert into voice_interviewer
           (slug, name, role_line, listens_for, opening_line, follow_up_style, stress_probes,
            cadence, voice_id, voice_engine, voice_language, members, source_yaml, is_published,
            retired_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, null)
         on conflict (slug) do update
           set name = excluded.name, role_line = excluded.role_line,
               listens_for = excluded.listens_for, opening_line = excluded.opening_line,
               follow_up_style = excluded.follow_up_style,
               stress_probes = excluded.stress_probes, cadence = excluded.cadence,
               voice_id = excluded.voice_id, voice_engine = excluded.voice_engine,
               voice_language = excluded.voice_language, members = excluded.members,
               source_yaml = excluded.source_yaml, is_published = true, retired_at = null`,
        [person.slug, person.name, person.role.trim(), person.listens_for,
         person.opening_line.trim(), person.follow_up_style.trim(), person.stress_probes,
         person.cadence, person.voice?.id ?? null, person.voice?.engine ?? "neural",
         person.voice?.language ?? null, person.members ?? [], source]);
    }
    await client.query(
      `update voice_interviewer set retired_at = now()
        where retired_at is null and not (slug = any($1::text[]))`, [slugs]);
    return slugs.length;
  });
}
