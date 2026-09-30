/**
 * The markdown every brief, contract, hint and walkthrough is written in.
 *
 * A small renderer rather than a library, because the problem files use a
 * small subset and everything here becomes React elements: no raw HTML from a
 * problem file ever reaches the page. Single newlines inside a paragraph are
 * soft breaks, which is what makes a hard-wrapped YAML block read as prose.
 *
 * Supported: paragraphs, headings, bullet and numbered lists, fenced and
 * indented code, block quotes, tables, and inline code, bold, italic and links.
 */
import { Fragment, type ReactNode } from "react";
import { cn } from "./cn";

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; head: string[]; align: Array<"left" | "right" | "center">; rows: string[][] };

const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;
const INDENTED = /^( {4}|\t)/;

const blank = (line: string) => line.trim() === "";

function startsBlock(line: string, next: string | undefined): boolean {
  return FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || ORDERED.test(line) ||
    QUOTE.test(line) || (TABLE_ROW.test(line) && next !== undefined && TABLE_RULE.test(next));
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }

    if (INDENTED.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (INDENTED.test(lines[i]!) || blank(lines[i]!))) {
        body.push(lines[i]!.replace(INDENTED, ""));
        i++;
      }
      while (body.length && blank(body[body.length - 1]!)) body.pop();
      blocks.push({ kind: "code", lang: "", text: body.join("\n") });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        body.push(QUOTE.exec(lines[i]!)![1]!);
        i++;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map((rule) =>
        rule.startsWith(":") && rule.endsWith(":") ? "center" as const
          : rule.endsWith(":") ? "right" as const : "left" as const);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        rows.push(cells(lines[i]!));
        i++;
      }
      blocks.push({ kind: "table", head, align, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !bullet;
      const marker = isOrdered ? ORDERED : BULLET;
      const items: string[] = [];
      const start = ordered ? Number(ordered[2]) : 1;
      while (i < lines.length) {
        const current = lines[i]!;
        const match = marker.exec(current);
        if (match) {
          items.push(isOrdered ? match[3]! : match[2]!);
          i++;
          continue;
        }
        if (blank(current)) {
          // A blank line ends the list unless the next line carries on with it.
          const next = lines[i + 1];
          if (next !== undefined && (marker.test(next) || /^\s{2,}\S/.test(next))) {
            i++;
            continue;
          }
          break;
        }
        if (/^\s{2,}\S/.test(current) || !startsBlock(current, lines[i + 1])) {
          // A continuation line belongs to the item above it.
          if (!items.length) break;
          items[items.length - 1] += `\n${current.trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", ordered: isOrdered, start, items });
      continue;
    }

    const body: string[] = [];
    while (i < lines.length && !blank(lines[i]!) &&
           (body.length === 0 || !startsBlock(lines[i]!, lines[i + 1]))) {
      body.push(lines[i]!.trim());
      i++;
    }
    blocks.push({ kind: "p", text: body.join("\n") });
  }
  return blocks;
}

const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|(?<![\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])|(?<![\w])_(?=\S)([^_]+?)(?<=\S)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;

function safeHref(href: string): string | null {
  if (/^https?:\/\//i.test(href) || href.startsWith("/") || href.startsWith("#")) return href;
  return null;
}

/** Inline markdown to React. Soft line breaks become spaces. */
export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const source = text.replace(/\s*\n\s*/g, " ");
  let last = 0;
  let n = 0;
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(source.slice(last, index));
    const key = `${keyPrefix}-${n++}`;
    if (match[1] !== undefined) {
      out.push(
        <code key={key}
              className="rounded-key border border-border bg-surface-2 px-1 py-px font-mono
                         text-[0.92em] text-text">
          {match[2]!.trim() === "" ? match[2] : match[2]!.replace(/^ (.*) $/, "$1")}
        </code>);
    } else if (match[3] !== undefined) {
      out.push(<strong key={key} className="font-semibold text-text">
        {renderInline(match[3], key)}
      </strong>);
    } else if (match[4] !== undefined || match[5] !== undefined) {
      out.push(<em key={key}>{renderInline((match[4] ?? match[5])!, key)}</em>);
    } else if (match[6] !== undefined) {
      const href = safeHref(match[7]!);
      const external = href !== null && /^https?:/i.test(href);
      out.push(href ? (
        <a key={key} href={href} className="text-accent underline-offset-2 hover:underline"
           {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {renderInline(match[6], key)}
        </a>
      ) : <Fragment key={key}>{renderInline(match[6], key)}</Fragment>);
    }
    last = index + match[0].length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

export function Markdown({ source, className, compact = false }: {
  source: string | null | undefined;
  className?: string;
  /** Tighter rhythm, for hints, table cells and anything inside a small box. */
  compact?: boolean;
}) {
  if (!source?.trim()) return null;
  const blocks = parseBlocks(source);
  const gap = compact ? "mt-2 first:mt-0" : "mt-3 first:mt-0";
  return (
    <div className={cn("min-w-0 text-body leading-[1.65] text-text", className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "p":
            return <p key={key} className={gap}>{renderInline(block.text, key)}</p>;
          case "h": {
            const size = block.level <= 2 ? "text-lead" : "text-body";
            return (
              <p key={key} role="heading" aria-level={Math.min(6, block.level + 2)}
                 className={cn(gap, "mt-5 font-semibold text-text", size)}>
                {renderInline(block.text, key)}
              </p>
            );
          }
          case "code":
            return (
              <pre key={key}
                   className={cn(gap, "overflow-x-auto rounded-control border border-border",
                                 "bg-surface-2 px-3 py-2.5 font-mono text-meta leading-[1.6]",
                                 "text-text")}>
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined}
                   className={cn(gap, "space-y-1.5 pl-5 marker:text-text-faint",
                                 block.ordered ? "list-decimal" : "list-disc")}>
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`} className="pl-1">{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={key}
                          className={cn(gap, "border-l-2 border-border-strong pl-3 text-text-dim")}>
                <Markdown source={block.text} compact />
              </blockquote>
            );
          case "table":
            return (
              <div key={key} className={cn(gap, "overflow-x-auto rounded-control border border-border")}>
                <table className="w-full border-collapse text-left text-meta">
                  <thead className="bg-surface-2 text-text-dim">
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={j} scope="col" style={{ textAlign: block.align[j] ?? "left" }}
                            className="px-3 py-2 font-medium">{renderInline(cell, `${key}-h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-t border-border">
                        {row.map((cell, j) => (
                          <td key={j} style={{ textAlign: block.align[j] ?? "left" }}
                              className="px-3 py-2 align-top">
                            {renderInline(cell, `${key}-${r}-${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
