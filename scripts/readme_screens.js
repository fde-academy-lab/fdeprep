/**
 * The README screenshots, captured from the seeded development database so a
 * later capture matches the committed ones.
 *
 * Run the application and the worker against a seeded database first:
 *
 *   createdb fdeprep_docs
 *   export DATABASE_URL=postgres://localhost/fdeprep_docs
 *   cd web && npm run migrate && npm run import:content && npm run db:seed
 *   AUTH_DEV_LEARNER=1 AUTH_SECRET=readme-screenshots-only \
 *     VOICE_SOCKET_URL=ws://localhost:8787 VOICE_TOKEN_SECRET=readme-screenshots-only \
 *     npx next dev --webpack -p 3102
 *   npm run worker            in a second terminal, with the same DATABASE_URL
 *
 * Then, from the repository root:
 *
 *   node scripts/readme_screens.js
 *
 * It needs Playwright with Chromium. `PLAYWRIGHT_MODULE` names the package
 * when it is installed somewhere other than node_modules, and `SCREENS` is a
 * comma-separated list to capture only some of the eight.
 *
 * Learner screens are captured as the seeded learner priya-raghavan, app_user
 * id 2, whose session cookie is minted here with the same HMAC the
 * application uses, so the capture needs the AUTH_SECRET above. The admin
 * screen is the development admin, which is who AUTH_DEV_LEARNER=1 signs in
 * with no cookie. The viewport is 1,180 pixels wide, the narrowest width the
 * product supports (docs/01), and the numbered markers are injected into the
 * page before the capture, so the README's step text can refer to them.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE ?? "http://localhost:3102";
const OUT = process.env.OUT ?? path.join(__dirname, "..", "docs", "images");
/** The seeded learner's scored sessions to show: a guided answer, and an interview. */
const DEBRIEF_SESSION = process.env.DEBRIEF_SESSION ?? "126";
const SECRET = process.env.AUTH_SECRET ?? "readme-screenshots-only";
const LEARNER_UID = 2;
const WIDTH = 1180;
const HEIGHT = 860;

/** web/lib/auth/session.ts: a base64url payload and an HMAC-SHA256 over it. */
function mintSession(uid) {
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = Buffer.from(JSON.stringify({ uid, exp })).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest().toString("base64url");
  return `${payload}.${signature}`;
}

/**
 * A believable mid-attempt solution to extract-a-ticket-without-guessing: it
 * builds the ticket from FIELDS and copies every value the model returns, and
 * stated_in still says yes to everything. Both public cases pass and the
 * hidden cases that check for invented values fail.
 */
const PARTIAL_SOLUTION = `import json
import re

FIELDS = ("order_id", "email", "phone")


def build_prompt(email_text: str) -> str:
    return (
        "Read the customer email below. Reply with a JSON object with the keys "
        "order_id, email and phone. Use null for anything the email does not "
        "state.\\n\\n"
        f"Email:\\n{email_text}\\n"
    )


def run_agent(question: str, llm, tools: dict) -> str:
    reply = llm(build_prompt(question))
    extracted = json.loads(reply)
    ticket = {name: None for name in FIELDS}
    for name in FIELDS:
        value = extracted.get(name)
        if stated_in(value, question):
            ticket[name] = value
    return json.dumps(ticket)


def stated_in(value, email_text: str) -> bool:
    """True when value is a non-empty string that the email contains."""
    # TODO 4: check the type first (a number, a list or None is never
    #         stated), then look for the value in email_text, ignoring case
    return True
`;

const MARKER_CSS = `
  nextjs-portal { display: none !important; }
  .rm-marker {
    position: absolute; z-index: 2147483647; width: 28px; height: 28px; border-radius: 50%;
    background: #F5F7FA; color: #0A0B0D; font: 700 15px/28px Geist, "Geist Sans", system-ui, sans-serif;
    text-align: center; box-shadow: 0 0 0 2px #0A0B0D, 0 2px 10px rgba(0,0,0,.7); pointer-events: none;
  }
`;

/**
 * Numbered markers beside each located element, in document coordinates.
 * gutter puts the marker in the page margin to the left, corner inside the
 * element's top-left corner, right just past its right edge, inside-right
 * inside its top-right corner, and above in the gap over it.
 */
async function mark(page, targets, { place: defaultPlace = "gutter" } = {}) {
  await page.addStyleTag({ content: MARKER_CSS });
  let n = 0;
  for (const target of targets) {
    n += 1;
    const spec = typeof target === "object" && target !== null && "at" in target
      ? target : { at: target };
    const at = spec.at;
    const locator = typeof at === "function" ? at(page) : page.locator(at);
    const handle = await locator.first().elementHandle({ timeout: 15000 }).catch(() => null);
    if (!handle) {
      console.warn(`  marker ${n}: nothing matched`);
      continue;
    }
    await handle.evaluate((el, { number, place }) => {
      const rect = el.getBoundingClientRect();
      const marker = document.createElement("div");
      marker.className = "rm-marker";
      marker.textContent = String(number);
      const spots = {
        gutter: [rect.left - 40, rect.top - 2],
        corner: [rect.left + 6, rect.top + 6],
        right: [rect.right + 10, rect.top - 2],
        "inside-right": [rect.right - 34, rect.top + 6],
        above: [rect.left, rect.top - 32],
      };
      const [left, top] = spots[place] ?? spots.corner;
      marker.style.left = `${Math.max(0, left + window.scrollX)}px`;
      marker.style.top = `${Math.max(0, top + window.scrollY)}px`;
      document.body.appendChild(marker);
    }, { number: n, place: spec.place ?? defaultPlace });
  }
}

const ONLY = (process.env.SCREENS ?? "").split(",").filter(Boolean);
const wanted = (name) => ONLY.length === 0 || ONLY.includes(name);

async function shoot(page, name, height) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: WIDTH, height } });
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ${name}.png ${kb} KB, ${WIDTH}x${height}`);
}

async function open(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // The learner: seeded, steady, with attempts and voice answers behind her.
  const learner = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, colorScheme: "dark",
  });
  await learner.addCookies([{
    name: "fdeprep_session", value: mintSession(LEARNER_UID), domain: "localhost", path: "/",
  }]);
  const page = await learner.newPage();

  if (wanted("home")) {
    console.log("home");
    await open(page, "/");
    await mark(page, [
      "main dl",
      'section[aria-labelledby="next-up"]',
      'section[aria-labelledby="competencies"]',
      'section[aria-labelledby="readiness"]',
      'section[aria-labelledby="recent"]',
    ]);
    await shoot(page, "home", 1180);
  }

  if (wanted("problems")) {
    console.log("problems");
    await open(page, "/problems");
    await mark(page, [
      'section[aria-labelledby^="stage-"] h2',
      'section[aria-labelledby^="stage-"] ul li',
      'nav[aria-label="Stage"]',
      'form[role="search"]',
    ]);
    await shoot(page, "problems", 1320);
  }

  if (wanted("workspace")) {
    console.log("workspace");
    await open(page, "/problems/extract-a-ticket-without-guessing");
    await page.locator(".cm-content").first().waitFor({ timeout: 60000 });
    await page.evaluate((code) => {
      // @codemirror/view 6.43 keeps its tile on the content node, and the root tile holds the view.
      const view = document.querySelector(".cm-content").cmTile.root.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    }, PARTIAL_SOLUTION);
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /^Run/ }).first().click();
    // The results pane writes a case name with spaces for its underscores.
    await page.getByText("a complete email fills every field").first().waitFor({ timeout: 180000 });
    await page.getByRole("button", { name: /^Run/ }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await mark(page, [
      { at: (p) => p.getByRole("tab", { name: /Attempts/ }), place: "right" },
      { at: 'section[aria-label="The situation"]', place: "corner" },
      { at: (p) => p.getByText("solution.py", { exact: true }), place: "right" },
      { at: (p) => p.getByRole("button", { name: /^Run/ }), place: "corner" },
      { at: (p) => p.getByText("Coach", { exact: true }), place: "right" },
      { at: (p) => p.getByText(/public test/), place: "right" },
    ]);
    await shoot(page, "workspace", HEIGHT);
  }

  if (wanted("voice")) {
    console.log("voice");
    await open(page, "/voice");
    await mark(page, [
      "main h1",
      'nav[aria-label="Filter the questions"]',
      "main table",
      { at: (p) => p.locator("th", { hasText: /^Answer$/ }), place: "above" },
      (p) => p.getByRole("link", { name: "Meet the interviewers" }),
    ]);
    await shoot(page, "voice", 1100);
  }

  if (wanted("voice-lobby")) {
    console.log("voice lobby");
    await open(page, "/voice/session?q=improve-a-service-you-cannot-rewrite&interviewer=cto");
    await mark(page, [
      'nav[aria-label="Choose your interviewer"]',
      (p) => p.locator('section[aria-label="Your interviewer"]').locator("xpath=preceding-sibling::div[1]"),
      'section[aria-label="Your interviewer"]',
      'section[aria-label="How to answer it"]',
      'section[aria-label="Tips people overlook"]',
      (p) => p.locator("h2", { hasText: "How you will answer" }),
    ]);
    await shoot(page, "voice-lobby", 1940);
  }

  if (wanted("voice-debrief")) {
    console.log("voice debrief");
    await open(page, `/voice/sessions/${DEBRIEF_SESSION}`);
    await mark(page, [
      (p) => p.locator("main > p", { hasText: /^Asked by/ }),
      "section.results-pane",
      (p) => p.locator("h2", { hasText: /^Beats$/ }),
      (p) => p.locator("h2", { hasText: /^Interview$/ }),
    ]);
    await shoot(page, "voice-debrief", 2000);
  }

  if (wanted("progress")) {
    console.log("progress");
    await open(page, "/progress");
    await mark(page, [
      'section[aria-labelledby="readiness"]',
      (p) => p.locator("h2", { hasText: "Competency heatmap" }),
      "#history",
      "a[download]",
    ]);
    await shoot(page, "progress", 1320);
  }

  await learner.close();

  if (wanted("admin-overview")) {
    // The development admin, with no cookie.
    const admin = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, colorScheme: "dark",
    });
    const adminPage = await admin.newPage();
    console.log("admin overview");
    await open(adminPage, "/admin");
    await mark(adminPage, [
      { at: (p) => p.getByRole("link", { name: "Ops" }), place: "right" },
      { at: "main dl > div:last-child", place: "inside-right" },
      { at: (p) => p.locator("th", { hasText: "Last activity" }), place: "above" },
      { at: "main table tbody tr", place: "inside-right" },
    ]);
    await shoot(adminPage, "admin-overview", 1100);
    await admin.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
