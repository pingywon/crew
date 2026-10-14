// Phone + desktop walkthrough with real mobile emulation.
//   BASE=http://127.0.0.1:8173/ node e2e/phone.mjs      (live-job test needs MOCK_ENGINE=1 on the server)
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE || "http://127.0.0.1:8173/";
const SHOTS = process.env.SHOTS || join(root, "shots");
const LIVE = process.env.SKIP_LIVE !== "1";
await mkdir(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const devices = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "small", width: 360, height: 640, mobile: true },
  { name: "desk", width: 1366, height: 900, mobile: false },
];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const sideways = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
const smallTargets = (page) => page.evaluate(() => [...document.querySelectorAll(".btn, .sample-list button, .back")]
  .filter((el) => el.offsetParent !== null)
  .map((el) => ({ t: el.textContent.trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height) }))
  .filter((x) => x.h < 40));
const spansInside = (page) => page.evaluate(() => [...document.querySelectorAll(".track")].every((t) => {
  const tr = t.getBoundingClientRect();
  return [...t.querySelectorAll(".span:not([hidden])")].every((s) => { const r = s.getBoundingClientRect(); return r.left >= tr.left - 1 && r.right <= tr.right + 1; });
}));

for (const scheme of ["light", "dark"]) {
  for (const d of devices) {
    const tag = `${d.name}-${scheme}`;
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.setViewport({ width: d.width, height: d.height, deviceScaleFactor: 2, isMobile: d.mobile, hasTouch: d.mobile });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    const tap = (sel) => (d.mobile ? page.tap(sel) : page.click(sel));

    await page.goto(BASE, { waitUntil: "networkidle0" });
    await page.waitForSelector("#hero-room .span");
    await new Promise((r) => setTimeout(r, 6800));
    const w = await sideways(page);
    check(`${tag}: page width is the device width`, w.iw === d.width, `innerWidth ${w.iw}`);
    check(`${tag}: landing has no sideways scroll`, w.sw <= w.iw, `scrollWidth ${w.sw}`);
    check(`${tag}: landing tap targets 40px+`, (await smallTargets(page)).length === 0, JSON.stringify(await smallTargets(page)));
    const lanes = await page.$$eval("#hero-room .track", (els) => els.length);
    check(`${tag}: hero run shows 6+ lanes`, lanes >= 6, String(lanes));
    check(`${tag}: hero bars stay inside their lanes`, await spansInside(page));
    const parallel = await page.evaluate(() => {
      const bars = [...document.querySelectorAll("#hero-room .track")].slice(1, -2).map((t) => t.querySelector(".span").getBoundingClientRect().left);
      return Math.max(...bars) - Math.min(...bars) < 30;
    });
    check(`${tag}: specialists start together`, parallel);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`${tag}: theme background`, scheme === "dark" ? bg === "rgb(26, 26, 24)" : bg === "rgb(250, 250, 248)", bg);
    const taBg = await page.$eval("#job-text", (el) => getComputedStyle(el).backgroundColor);
    check(`${tag}: textarea uses the theme`, scheme === "dark" ? taBg === "rgb(35, 35, 33)" : taBg === "rgb(255, 255, 255)", taBg);
    check(`${tag}: version in footer`, /v\d+\.\d+\.\d+/.test(await page.$eval("footer.site p", (el) => el.textContent)));
    await page.screenshot({ path: join(SHOTS, `${tag}-landing.png`) });

    await page.$eval(".sample-list li:nth-child(2) button", (el) => el.scrollIntoView({ block: "center" }));
    await tap(".sample-list li:nth-child(2) button");
    await page.waitForSelector(".doc h2");
    const sections = await page.$$eval(".doc section h2:not(.small)", (els) => els.length);
    check(`${tag}: finished page has 3+ sections`, sections >= 3, String(sections));
    check(`${tag}: each section names its writer`, (await page.$$eval(".byline", (els) => els.length)) === sections);
    const w2 = await sideways(page);
    check(`${tag}: page has no sideways scroll`, w2.sw <= w2.iw, `scrollWidth ${w2.sw}`);
    check(`${tag}: page tap targets 40px+`, (await smallTargets(page)).length === 0, JSON.stringify(await smallTargets(page)));
    await page.screenshot({ path: join(SHOTS, `${tag}-run.png`) });

    await page.$eval("#result-view .room .btn.quiet", (el) => el.scrollIntoView({ block: "center" }));
    await tap("#result-view .room .btn.quiet");
    await new Promise((r) => setTimeout(r, 1500));
    const mid = await page.$$eval("#result-view .room .log li:not([hidden])", (els) => els.length);
    const all = await page.$$eval("#result-view .room .log li", (els) => els.length);
    check(`${tag}: replay plays the run in order`, mid < all, `${mid} of ${all} log lines at 1.5s`);
    await page.waitForFunction(() => [...document.querySelectorAll("#result-view .room .log li")].every((li) => !li.hidden), { timeout: 15000 });
    check(`${tag}: replay finishes`, true);
    check(`${tag}: bars stay inside their lanes`, await spansInside(page));

    const table = await page.$(".table-wrap");
    if (table) {
      const fits = await page.evaluate(() => [...document.querySelectorAll(".table-wrap")].every((t) => t.getBoundingClientRect().right <= window.innerWidth + 1));
      check(`${tag}: tables scroll inside their box`, fits);
      await table.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: join(SHOTS, `${tag}-table.png`) });
    }

    if (LIVE && d.name !== "small") {
      await page.goto(BASE, { waitUntil: "networkidle0" });
      await page.type("#job-text", "Plan a kitchen remodel for $25,000 with new cabinets and counters.");
      await tap("#job-btn");
      await page.waitForSelector(".room .span", { timeout: 10000 });
      check(`${tag}: live job draws the timeline as it runs`, true);
      await page.waitForFunction(() => document.querySelector(".doc .summary")?.textContent === "A test summary.", { timeout: 20000 });
      check(`${tag}: live job ends on the finished page`, true);
      check(`${tag}: revised part is labelled`, (await page.$$eval(".byline .rev", (els) => els.length)) === 1);
    }

    check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
