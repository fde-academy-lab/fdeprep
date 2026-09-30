/**
 * The parts of a problem page that spell out what the brief implies: the tools
 * the agent has, one case worked in the open, and the traps the hidden cases
 * catch. The page decides which of them this learner may see; these only draw.
 */
import { TriangleAlert } from "lucide-react";
import type { KitExample, KitTool } from "@/lib/problems/kit";
import { Markdown } from "@/components/ui/markdown";
import { renderCode } from "@/components/ui/code";

/** A value as Python would write it, so the example reads like the code the learner writes. */
export function pythonLiteral(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${pythonLiteral(v)}`).join(", ")}}`;
  }
  return JSON.stringify(String(value));
}

export function ToolTable({ tools }: { tools: KitTool[] }) {
  return (
    <div className="overflow-hidden rounded-control border border-border">
      <p className="border-b border-border bg-surface-2 px-3 py-1.5 text-meta font-medium text-text-dim">
        Tools the agent has
      </p>
      <dl className="divide-y divide-border text-meta">
        {tools.map((tool) => (
          <div key={tool.name} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(9rem,auto)_1fr] sm:gap-3">
            <dt><code className="font-mono text-text">{tool.name}({tool.args})</code></dt>
            <dd className="text-text-dim">{renderCode(tool.returns)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function WorkedExample({ example }: { example: KitExample }) {
  if (example.kind === "message") {
    return (
      <div className="space-y-2">
        <figure className="rounded-panel border border-border bg-surface px-4 py-3">
          <figcaption className="text-meta text-text-faint">The model receives:</figcaption>
          <blockquote className="mt-1 text-text">{renderCode(example.message)}</blockquote>
        </figure>
        <p className="text-text-dim"><span className="text-text-faint">The model should: </span>
          {renderCode(example.expect)}</p>
      </div>
    );
  }
  const call = Object.entries(example.input)
    .map(([key, value]) => `${key} = ${pythonLiteral(value)}`).join("\n");
  return (
    <div className="space-y-2">
      <p className="text-meta text-text-faint">
        The public case <code className="font-mono text-text-dim">{example.case}</code> calls{" "}
        <code className="font-mono text-text-dim">run_agent</code> with:
      </p>
      <Markdown source={"```python\n" + (call || "# no arguments") + "\n```"} compact />
      <p className="text-text-dim"><span className="text-text-faint">Expected: </span>
        {renderCode(example.expect)}</p>
    </div>
  );
}

export function Traps({ traps }: { traps: string[] }) {
  return (
    <ul className="space-y-2">
      {traps.map((trap) => (
        <li key={trap} className="flex gap-2.5 rounded-control border border-border bg-surface px-3 py-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.9} />
          <span className="text-text">{renderCode(trap)}</span>
        </li>
      ))}
    </ul>
  );
}
