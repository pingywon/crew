import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PROMPT_VERSION } from "../src/crew/prompts.js";

const manifest = JSON.parse(await readFile(new URL("../samples/manifest.json", import.meta.url), "utf8"));
const TELLS = [/—/, /!/, /\b(leverage|synergy|seamless|robust|cutting-edge|game-changer|unlock|streamline|empower|delve)\b/i, /\b(we|our|us|We|Our)\b/];

// Quoted speech (scripts and email templates the reader will say or send) is exempt from the voice rules.
const text = (run) => [run.summary, ...run.next_steps, ...run.sections.flatMap((s) => s.body.flatMap((b) => [b.text, ...(b.items || [])]))]
  .join("\n").replace(/"[^"]*"|“[^”]*”/g, "");

for (const s of manifest) {
  test(`sample "${s.id}" is a complete, current run`, async () => {
    const { run } = JSON.parse(await readFile(new URL(`../public/samples/${s.id}.json`, import.meta.url), "utf8"));
    assert.equal(run.prompt, PROMPT_VERSION, "made with the current prompts; run npm run samples");
    assert.equal(run.request, s.job);
    assert.ok(run.sections.length >= 3 && run.sections.length <= 4);
    assert.ok(run.next_steps.length >= 3);
    for (const re of TELLS) assert.doesNotMatch(text(run), re, `${s.id}: ${re}`);
    const agents = new Set(run.events.map((e) => e.agent));
    for (const a of ["lead", "reviewer", "editor"]) assert.ok(agents.has(a), a);
    const opened = run.events.filter((e) => e.kind === "start").length;
    const closed = run.events.filter((e) => e.kind === "done").length;
    assert.equal(opened, closed, "every piece of work finished");
  });
}
