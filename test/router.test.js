import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { route } from "../src/router.js";
import { VERSION } from "../src/version.js";
import { mockModel } from "../src/crew/mock.js";

const deps = { model: mockModel };
const job = (text, ip = "203.0.113.9") => new Request("https://crew.test/api/job", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ job: text }) });
const JOB = "Plan a kitchen remodel for $25,000 with new cabinets.";
function fakeKV() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) }; }

test("version file matches package.json", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("meta and the engine switch", async () => {
  assert.equal((await (await route(new Request("https://crew.test/api/meta"), {})).json()).live, false);
  assert.equal((await (await route(new Request("https://crew.test/api/meta"), { ANTHROPIC_API_KEY: "k" })).json()).live, true);
  assert.equal((await route(job(JOB), {}, null, deps)).status, 503);
});

test("jobs are length-checked", async () => {
  const env = { MOCK_ENGINE: "1" };
  assert.equal((await route(job("too short"), env, null, deps)).status, 400);
  assert.equal((await route(job("x".repeat(2001)), env, null, deps)).status, 400);
  assert.equal((await route(new Request("https://crew.test/api/job"), env, null, deps)).status, 405);
});

test("a job streams every step and then the page", async () => {
  const res = await route(job(JOB), { MOCK_ENGINE: "1" }, null, deps);
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const text = await res.text();
  const steps = [...text.matchAll(/event: step\ndata: (.+)/g)].map((m) => JSON.parse(m[1]));
  assert.ok(steps.length >= 12);
  assert.deepEqual([...new Set(steps.map((s) => s.agent))], ["lead", "part:costs", "part:order", "part:risks", "reviewer", "editor"]);
  const result = JSON.parse(text.match(/event: result\ndata: (.+)/)[1]);
  assert.equal(result.run.sections.length, 3);
  assert.equal(result.meta.version, VERSION);
});

test("model failures arrive as a plain message", async () => {
  const text = await (await route(job(JOB), { MOCK_ENGINE: "1" }, null, { model: async () => { throw new Error("secret detail"); } })).text();
  const failure = JSON.parse(text.match(/event: failure\ndata: (.+)/)[1]);
  assert.equal(failure.code, "server");
  assert.doesNotMatch(failure.message, /secret detail/);
});

test("each visitor gets a daily allowance", async () => {
  const env = { MOCK_ENGINE: "1", CREW_KV: fakeKV(), JOBS_PER_VISITOR: "1", JOBS_PER_DAY: "2" };
  assert.equal((await route(job(JOB, "198.51.100.1"), env, null, deps)).status, 200);
  assert.equal((await route(job(JOB, "198.51.100.1"), env, null, deps)).status, 429);
  assert.equal((await route(job(JOB, "198.51.100.2"), env, null, deps)).status, 200);
  assert.equal((await route(job(JOB, "198.51.100.3"), env, null, deps)).status, 429);
});
