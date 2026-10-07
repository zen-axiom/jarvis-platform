// Cloud/CI browser checks for the mock HUD. Uses an already-installed Chromium only; it never
// downloads a browser. Any request that is not to the local dev server fails the run.
//
//   npm run shots                      (writes PNGs to web/shots/, exits non-zero on any failure)
//   CHROMIUM_PATH=/path/to/chrome npm run shots
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "shots");
const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STATES = ["idle", "listening", "thinking", "speaking", "error", "approval_needed"];
const DESKTOP = [
  { w: 1920, h: 1080 },
  { w: 1536, h: 864 },
  { w: 1280, h: 800 },
];
const NARROW = { w: 430, h: 900 };
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-win/chrome.exe"]) {
      const p = join(base, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL: ${msg}`);
};
let marked = 0;
const ok = (msg) => {
  if (failures.length > marked) {
    marked = failures.length;
    return;
  }
  console.log(`ok:   ${msg}`);
};

async function newPage(browser, viewport, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.w, height: viewport.h },
    reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
  });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    fail(`blocked non-local request: ${url}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && fail(`console error: ${m.text()}`));
  page.on("pageerror", (e) => fail(`page error: ${e.message}`));
  return { page, context };
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);

async function expectNoUrduScript(page, label) {
  if (ARABIC.test(await bodyText(page))) fail(`${label}: Urdu/Arabic script visible on page`);
}

/** Guard against a silently blank core: count lit pixels in the canvas. */
async function corePainted(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.core-canvas");
    if (!c) return { ok: false, why: "no canvas" };
    const ctx = c.getContext("2d");
    if (!ctx) return { ok: false, why: "no 2d context" };
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      if (data[i] + data[i + 1] + data[i + 2] > 40 && data[i + 3] > 20) lit++;
    }
    const sampled = Math.ceil(data.length / (4 * 97));
    return { ok: lit / sampled > 0.01, ratio: lit / sampled, w: c.width, h: c.height };
  });
}

/** Fraction of the viewport the stage (core area) occupies - catches a cramped layout. */
async function stageShare(page) {
  return page.evaluate(() => {
    const s = document.querySelector(".stage");
    if (!s) return 0;
    const r = s.getBoundingClientRect();
    return (r.width * r.height) / (window.innerWidth * window.innerHeight);
  });
}

const chromePath = findChromium();
if (!chromePath) {
  console.error("No Chromium found. Set CHROMIUM_PATH or PLAYWRIGHT_BROWSERS_PATH. Not downloading one.");
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const server = await createServer({
  root,
  logLevel: "warn",
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ executablePath: chromePath, args: ["--no-sandbox"] });

try {
  // 1. Static previews of every state at desktop sizes.
  for (const vp of DESKTOP) {
    for (const state of STATES) {
      const { page, context } = await newPage(browser, vp);
      await page.goto(`${ORIGIN}/?state=${state}`);
      await page.waitForSelector(".app");
      await page.waitForTimeout(900);
      const attr = await page.getAttribute(".app", "data-state");
      if (attr !== state) fail(`state ${state}: data-state was ${attr}`);
      const hasDialog = (await page.locator('[role="alertdialog"]').count()) > 0;
      if (hasDialog !== (state === "approval_needed")) fail(`state ${state}: approval card presence wrong`);
      const text = await bodyText(page);
      if (!text.includes("mock mode")) fail(`state ${state}: mock-mode label missing`);
      if (!/mission/i.test(text)) fail(`state ${state}: mission panel missing`);
      if (!/demo/i.test(text)) fail(`state ${state}: demo labelling missing`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      if (overflow) fail(`state ${state} @${vp.w}: horizontal overflow`);
      const paint = await corePainted(page);
      if (!paint.ok) fail(`state ${state} @${vp.w}: core canvas looks blank (${JSON.stringify(paint)})`);
      const share = await stageShare(page);
      if (share < 0.24) fail(`state ${state} @${vp.w}: stage only ${(share * 100).toFixed(0)}% of viewport`);
      await expectNoUrduScript(page, `state ${state} @${vp.w}`);
      await page.screenshot({ path: join(outDir, `${state}-${vp.w}x${vp.h}.png`) });
      await context.close();
    }
  }
  ok(`static previews: ${STATES.length} states x ${DESKTOP.length} desktop sizes, core painted`);

  // 2. Narrow window: single column, no horizontal overflow, controls still reachable.
  for (const state of ["thinking", "approval_needed"]) {
    const { page, context } = await newPage(browser, NARROW);
    await page.goto(`${ORIGIN}/?state=${state}`);
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow) fail(`narrow ${state}: horizontal overflow`);
    const stop = page.getByRole("button", { name: /^Stop/ });
    if ((await stop.count()) === 0) fail(`narrow ${state}: Stop button missing`);
    await page.screenshot({ path: join(outDir, `${state}-narrow.png`), fullPage: true });
    await context.close();
  }
  ok("narrow window: single column, no overflow, Stop present");

  // 3. Reduced-motion previews still render a painted core.
  for (const state of ["thinking", "approval_needed"]) {
    const { page, context } = await newPage(browser, DESKTOP[0], { reducedMotion: true });
    await page.goto(`${ORIGIN}/?state=${state}`);
    await page.waitForTimeout(600);
    const paint = await corePainted(page);
    if (!paint.ok) fail(`reduced-motion ${state}: core canvas blank`);
    await page.screenshot({ path: join(outDir, `${state}-reduced-motion.png`) });
    await context.close();
  }
  ok("reduced-motion previews");

  // 4. The demo mission auto-runs and progresses through its steps.
  {
    const { page, context } = await newPage(browser, DESKTOP[0]);
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector(".steps", { timeout: 8000 });
    await page.waitForSelector(".step-ok", { timeout: 10000 });
    const txt = await bodyText(page);
    if (!/evening briefing/i.test(txt)) fail("demo mission title missing");
    if (!/demo/i.test(txt)) fail("demo mission not labelled as demo");
    await page.screenshot({ path: join(outDir, "live-demo-mission.png") });
    // it reaches the T2 approval and stops there
    await page.waitForSelector('[role="alertdialog"]', { timeout: 20000 });
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    if (focused !== "Deny") fail(`approval initial focus was ${focused}, expected Deny`);
    await page.screenshot({ path: join(outDir, "live-demo-approval.png") });
    await context.close();
    ok("demo mission auto-runs, progresses, and halts at the T2 approval");
  }

  // 5. Escape cancels: the sensitive action never runs.
  {
    const { page, context } = await newPage(browser, DESKTOP[0]);
    await page.goto(`${ORIGIN}/?scenario=approval`);
    await page.waitForSelector('[role="alertdialog"]', { timeout: 10000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector('[role="alertdialog"]', { state: "detached", timeout: 4000 });
    const list = await page.locator(".activity-list").innerText();
    if (!/cancelled/i.test(list)) fail("Escape did not record a cancelled activity");
    if (/\bdone\b/i.test(list)) fail("an activity completed after Escape cancelled the approval");
    await context.close();
    ok("Escape cancels and nothing executed");
  }

  // 6. Approve / deny outcomes.
  for (const [button, expected] of [["Approve once", /done/i], ["Deny", /denied/i]]) {
    const { page, context } = await newPage(browser, DESKTOP[0]);
    await page.goto(`${ORIGIN}/?scenario=approval`);
    await page.waitForSelector('[role="alertdialog"]', { timeout: 10000 });
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.waitForSelector('[role="alertdialog"]', { state: "detached", timeout: 4000 });
    await page.waitForTimeout(700);
    const list = await page.locator(".activity-list").innerText();
    if (!expected.test(list)) fail(`${button}: activity list did not match ${expected}`);
    await context.close();
  }
  ok("approve/deny outcomes");

  // 7. Roman Urdu live turn: Roman caption shown, no Urdu script anywhere.
  {
    const { page, context } = await newPage(browser, DESKTOP[0]);
    await page.goto(`${ORIGIN}/?scenario=roman_urdu`);
    await page.waitForSelector("text=Aap ke teen notes", { timeout: 10000 });
    await expectNoUrduScript(page, "roman_urdu live turn");
    await page.screenshot({ path: join(outDir, "live-roman-urdu.png") });
    await context.close();
    ok("Roman Urdu caption live turn");
  }

  // 8. A model returning Urdu script is replaced by the placeholder.
  {
    const { page, context } = await newPage(browser, DESKTOP[0]);
    await page.goto(`${ORIGIN}/?scenario=badcaption`);
    await page.waitForSelector("text=[caption unavailable]", { timeout: 10000 });
    await expectNoUrduScript(page, "badcaption");
    await context.close();
    ok("Urdu-script caption replaced by placeholder");
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`\nAll browser checks passed. Screenshots in ${outDir}`);
