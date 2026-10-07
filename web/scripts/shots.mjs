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
const VIEWPORTS = [
  { w: 1280, h: 900 },
  { w: 900, h: 760 },
  { w: 390, h: 844 },
];
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
const ok = (msg) => console.log(`ok:   ${msg}`);

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
  // 1. Static previews of every state at three viewport sizes.
  for (const vp of VIEWPORTS) {
    for (const state of STATES) {
      const { page, context } = await newPage(browser, vp);
      await page.goto(`${ORIGIN}/?state=${state}`);
      await page.waitForSelector(".app");
      await page.waitForTimeout(700);
      const attr = await page.getAttribute(".app", "data-state");
      if (attr !== state) fail(`state ${state}: data-state was ${attr}`);
      const hasDialog = (await page.locator('[role="alertdialog"]').count()) > 0;
      if (hasDialog !== (state === "approval_needed")) fail(`state ${state}: approval card presence wrong`);
      if (!(await bodyText(page)).includes("mock mode")) fail(`state ${state}: mock-mode label missing`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      if (overflow) fail(`state ${state} @${vp.w}: horizontal overflow`);
      await expectNoUrduScript(page, `state ${state} @${vp.w}`);
      await page.screenshot({ path: join(outDir, `${state}-${vp.w}x${vp.h}.png`), fullPage: true });
      await context.close();
    }
  }
  ok(`static previews: ${STATES.length} states x ${VIEWPORTS.length} viewports`);

  // 2. Reduced-motion preview still renders.
  for (const state of ["thinking", "approval_needed"]) {
    const { page, context } = await newPage(browser, VIEWPORTS[0], { reducedMotion: true });
    await page.goto(`${ORIGIN}/?state=${state}`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, `${state}-reduced-motion.png`) });
    await context.close();
  }
  ok("reduced-motion previews");

  // 3. Approval flow: focus on Deny, Escape cancels and nothing executes.
  {
    const { page, context } = await newPage(browser, VIEWPORTS[0]);
    await page.goto(`${ORIGIN}/?scenario=approval`);
    await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    if (focused !== "Deny") fail(`approval card initial focus was ${focused}, expected Deny`);
    await page.screenshot({ path: join(outDir, "live-approval.png") });
    await page.keyboard.press("Escape");
    await page.waitForSelector('[role="alertdialog"]', { state: "detached", timeout: 3000 });
    const text = await bodyText(page);
    if (!text.includes("Cancelled by user")) fail("Escape did not record a cancelled activity");
    if (/\bdone\b/i.test(await page.locator(".activity-list").innerText())) {
      fail("an activity completed after Escape cancelled the approval");
    }
    await context.close();
    ok("approval: focus on Deny, Escape cancels, nothing executed");
  }

  // 4. Approve once executes only the mock; Deny does not.
  for (const [button, expectDone] of [["Approve once", true], ["Deny", false]]) {
    const { page, context } = await newPage(browser, VIEWPORTS[0]);
    await page.goto(`${ORIGIN}/?scenario=approval`);
    await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.waitForSelector('[role="alertdialog"]', { state: "detached", timeout: 3000 });
    await page.waitForTimeout(600);
    const list = await page.locator(".activity-list").innerText();
    if (expectDone && !/done/.test(list)) fail(`${button}: expected a completed mock activity`);
    if (!expectDone && !/denied/.test(list)) fail(`${button}: expected a denied activity`);
    await context.close();
  }
  ok("approve/deny outcomes");

  // 5. Roman Urdu live turn: Roman caption shown, no Urdu script anywhere.
  {
    const { page, context } = await newPage(browser, VIEWPORTS[0]);
    await page.goto(`${ORIGIN}/?scenario=roman_urdu`);
    await page.waitForSelector("text=Aap ke teen notes", { timeout: 8000 });
    await expectNoUrduScript(page, "roman_urdu live turn");
    await page.screenshot({ path: join(outDir, "live-roman-urdu.png") });
    await context.close();
    ok("Roman Urdu caption live turn");
  }

  // 6. A model returning Urdu script is replaced by the placeholder.
  {
    const { page, context } = await newPage(browser, VIEWPORTS[0]);
    await page.goto(`${ORIGIN}/?scenario=badcaption`);
    await page.waitForSelector("text=[caption unavailable]", { timeout: 8000 });
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
