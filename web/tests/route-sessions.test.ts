/**
 * No API route skips the session check, story S15.13.
 *
 * The hole reported on 8 October 2026 was two route handlers that never asked
 * who was calling. Each was one forgotten line, and nothing would have noticed
 * a third. This walks every route file under app/api and fails on a handler
 * that does not resolve the session itself, through one of the helpers below,
 * unless its route is on the short list of public ones.
 *
 * Two checks. The first reads the source: every exported handler calls an
 * approved helper, imported from the module that owns it. The second runs
 * every handler with a forged cookie and again with none, and expects the same
 * 401 both times, so a handler that calls the helper and then ignores the
 * answer fails as well.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("next/headers", async (original) => ({
  ...(await original<typeof import("next/headers")>()),
  cookies: async () => ({
    get: (name: string) => (jar.cookie === undefined ? undefined : { name, value: jar.cookie }),
  }),
}));

import { mintSession, SESSION_TTL_S } from "../lib/auth/session.ts";
import { closeDb } from "../lib/db/pool.ts";

const API = path.join(import.meta.dirname, "..", "app", "api");
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const SECRET = "route-sessions-signing-secret";

/**
 * The helpers that resolve the session from the signed cookie, and the module
 * each has to come from. requireAdmin and requireFaculty resolve it through
 * learnerOrNull and throw SignedOut when nobody is signed in. currentLearner
 * is left out on purpose: it redirects, and a fetch cannot read the sign-in
 * page it lands on (lib/http/failure.ts).
 */
const APPROVED: Readonly<Record<string, string>> = {
  learnerOrNull: "@/lib/session/current",
  requireAdmin: "@/lib/admin/guard",
  requireFaculty: "@/lib/admin/guard",
};

/**
 * Open to a visitor with no session, each for a reason. A route belongs here
 * only when signing in or out needs it. Invite acceptance is the /invite page
 * rather than a route, and the callback below spends the invite. There is no
 * health route.
 */
const PUBLIC: Readonly<Record<string, string>> = {
  // Sign-in, step one: sends the browser to GitHub. Nobody has a session yet.
  "auth/start/route.ts": "sign-in",
  // Sign-in, step two: GitHub sends the browser back here, and this mints the session.
  "auth/callback/route.ts": "sign-in",
  // Signing out drops the cookie, and has to work when the cookie is expired or broken.
  "auth/signout/route.ts": "sign-out",
};

async function routeFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /^route\.tsx?$/.test(entry.name) ? [full] : [];
  }));
  return nested.flat().sort();
}

const relative = (file: string) => path.relative(API, file).split(path.sep).join("/");
const FILES = await routeFiles(API);

interface Reading {
  /** Each exported handler, and whether its body calls an approved helper. */
  handlers: Array<{ method: string; resolves: boolean }>;
  /** Export forms this check cannot see into. */
  unreadable: string[];
}

/** Reads one route file the way the compiler does, without running it. */
function read(file: string, source: string): Reading {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const approved = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      if (APPROVED[name] === from) approved.add(element.name.text);
    }
  }

  const calls = (node: ts.Node | undefined): boolean => {
    if (!node) return false;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        approved.has(node.expression.text)) return true;
    return ts.forEachChild(node, (child) => (calls(child) ? true : undefined)) ?? false;
  };

  const reading: Reading = { handlers: [], unreadable: [] };
  for (const statement of tree.statements) {
    const exported = ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && exported && statement.name &&
        METHODS.includes(statement.name.text)) {
      reading.handlers.push({ method: statement.name.text, resolves: calls(statement.body) });
    } else if (ts.isVariableStatement(statement) && exported) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && METHODS.includes(declaration.name.text)) {
          reading.handlers.push({ method: declaration.name.text, resolves: calls(declaration.initializer) });
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      // export { GET } from "./elsewhere" hands the check a name and no body.
      const names = statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map((element) => element.name.text) : ["*"];
      for (const name of names) {
        if (name === "*" || METHODS.includes(name)) reading.unreadable.push(`export { ${name} }`);
      }
    }
  }
  return reading;
}

/** Every bracketed segment of the route's path, given a value that parses as an id. */
function paramsFor(file: string): Record<string, string> {
  return Object.fromEntries([...relative(file).matchAll(/\[(\w+)\]/g)].map((match) => [match[1]!, "1"]));
}

function requestFor(file: string, method: string): Request {
  const url = `http://localhost/api/${relative(file).replace(/\/route\.tsx?$/, "").replace(/\[\w+\]/g, "1")}`;
  return method === "GET" || method === "HEAD"
    ? new Request(url, { method })
    : new Request(url, { method, headers: { "content-type": "application/json" }, body: "{}" });
}

/** The cookies anyone can make without the secret, the reported one first. */
function forgeries(): Array<[string, string]> {
  const [, signature] = mintSession({ uid: 1 }, SECRET).split(".");
  const claim = Buffer.from(JSON.stringify({ uid: 2, exp: 9_999_999_999 })).toString("base64url");
  const longAgo = Math.floor(Date.now() / 1000) - SESSION_TTL_S - 60;
  return [
    ["any value at all", "anything"],
    ["an edited claim under a real signature", `${claim}.${signature}`],
    ["a cookie signed with another secret", mintSession({ uid: 1 }, "not-the-secret")],
    ["a cookie that expired", mintSession({ uid: 1 }, SECRET, longAgo)],
  ];
}

const saved = { secret: process.env.AUTH_SECRET, dev: process.env.AUTH_DEV_LEARNER };

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
  // With the development learner on, no cookie means a signed-in admin.
  delete process.env.AUTH_DEV_LEARNER;
});

afterAll(async () => {
  if (saved.secret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = saved.secret;
  if (saved.dev === undefined) delete process.env.AUTH_DEV_LEARNER;
  else process.env.AUTH_DEV_LEARNER = saved.dev;
  jar.cookie = undefined;
  await closeDb();
});

describe("the walk", () => {
  it("reaches every route, the two that were open included", () => {
    const found = FILES.map(relative);
    expect(found.length).toBeGreaterThan(30);
    expect(found).toContain("submissions/[id]/route.ts");
    expect(found).toContain("submissions/[id]/events/route.ts");
    for (const open of Object.keys(PUBLIC)) expect(found, open).toContain(open);
  });
});

describe("every handler resolves the session through an approved helper", () => {
  for (const file of FILES.filter((f) => !(relative(f) in PUBLIC))) {
    it(relative(file), async () => {
      const reading = read(file, await readFile(file, "utf8"));
      expect(reading.unreadable, "export each handler as a function in this file").toEqual([]);
      expect(reading.handlers.length, "a route file with no handler").toBeGreaterThan(0);
      for (const handler of reading.handlers) {
        expect(handler.resolves,
          `${handler.method} must call ${Object.keys(APPROVED).join(", ")} from its own module, ` +
          "or the route must be on the commented PUBLIC list").toBe(true);
      }
    });
  }
});

describe("every handler answers a forged cookie the way it answers none", () => {
  for (const file of FILES.filter((f) => !(relative(f) in PUBLIC))) {
    it(relative(file), async () => {
      const route = (await import(file)) as Record<string, unknown>;
      const methods = METHODS.filter((method) => typeof route[method] === "function");
      expect(methods.length).toBeGreaterThan(0);

      for (const method of methods) {
        const handler = route[method] as (request: Request, context: unknown) => Promise<Response>;
        const ask = async () => {
          const response = await handler(requestFor(file, method),
            { params: Promise.resolve(paramsFor(file)) });
          return { status: response.status, body: await response.text() };
        };

        jar.cookie = undefined;
        const none = await ask();
        expect(none.status, `${method} with no cookie`).toBe(401);
        expect(JSON.parse(none.body).message, method).toMatch(/sign in again/i);

        for (const [forgery, cookie] of forgeries()) {
          jar.cookie = cookie;
          expect(await ask(), `${method}, ${forgery}`).toEqual(none);
        }
      }
    });
  }
});
