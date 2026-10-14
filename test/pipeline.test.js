import { test } from "node:test";
import assert from "node:assert/strict";
import { runCrew } from "../src/crew/pipeline.js";
import { mockModel } from "../src/crew/mock.js";

test("the lead plans, specialists work in parallel, the reviewer sends a part back, the editor assembles", async () => {
  const calls = [];
  const model = async (args) => { calls.push(args.role); return mockModel(args); };
  const run = await runCrew("Plan a kitchen remodel for $25,000.", { model });

  assert.deepEqual(calls, ["lead", "specialist", "specialist", "specialist", "reviewer", "specialist", "editor"]);
  assert.equal(run.calls, 7);
  assert.deepEqual(run.sections.map((s) => s.id), ["costs", "order", "risks"]);
  assert.deepEqual(run.sections.find((s) => s.id === "order").revised, ["Put the permit before demolition."]);
  assert.equal(run.sections.find((s) => s.id === "costs").revised, null);

  const starts = run.events.filter((e) => e.kind === "start" && e.agent.startsWith("part:")).slice(0, 3);
  const firstDone = run.events.find((e) => e.kind === "done" && e.agent.startsWith("part:"));
  assert.ok(starts.every((s) => s.t <= firstDone.t), "all three parts started before any finished");
  assert.ok(run.events.some((e) => e.kind === "note" && e.agent === "part:order"));
  assert.ok(run.events.find((e) => e.agent === "lead" && e.kind === "done").crew.length === 3);
});

test("plans are capped at 4 parts with unique ids", async () => {
  const model = async (args) => {
    if (args.role === "lead") {
      return { title: "T", goal: "G", assumptions: [], checks: [], sections: Array.from({ length: 6 }, (_, i) => ({ id: "Same Id!", heading: `H${i}`, role: "R", brief: "B" })) };
    }
    return mockModel(args);
  };
  const run = await runCrew("A job long enough to plan.", { model });
  assert.equal(run.sections.length, 4);
  assert.equal(new Set(run.sections.map((s) => s.id)).size, 4);
});

test("at most two parts are revised", async () => {
  const model = async (args) => {
    if (args.role === "reviewer") return { parts: ["costs", "order", "risks"].map((id) => ({ id, verdict: "revise", notes: ["Fix it."] })), conflicts: ["x"] };
    return mockModel(args);
  };
  const run = await runCrew("A job long enough to plan.", { model });
  assert.equal(run.sections.filter((s) => s.revised).length, 2);
  assert.deepEqual(run.conflicts, ["x"]);
});
