// A crew run: the lead plans, specialists write in parallel, a reviewer sends parts back, the editor assembles.
import { PlanSchema, PartSchema, ReviewSchema, PageSchema } from "./schemas.js";
import { LEAD, SPECIALIST, REVIEWER, REVISER, EDITOR, PROMPT_VERSION, specialistMessage, draftMessage } from "./prompts.js";

export const MIN_CHARS = 20;
export const MAX_CHARS = 2000;
const MAX_SECTIONS = 4;
const MAX_REVISIONS = 2;

const slug = (s, i) => (String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `part-${i + 1}`).slice(0, 24);

// model: async ({ role, system, user, schema, effort }) => parsed object
export async function runCrew(request, { model, onEvent = () => {} }) {
  const events = [];
  const t0 = Date.now();
  const emit = (e) => {
    const event = { ...e, t: Date.now() - t0 };
    events.push(event);
    onEvent(event);
  };
  const work = async (agent, label, fn, done) => {
    emit({ agent, kind: "start", label });
    const out = await fn();
    emit({ agent, kind: "done", label, text: done(out) });
    return out;
  };

  emit({ agent: "lead", kind: "start", label: "Plans the page" });
  const plan = await model({ role: "lead", system: LEAD, user: `The request, between the markers:\n<<<REQUEST\n${request}\nREQUEST>>>`, schema: PlanSchema, effort: "medium" });
  plan.sections = plan.sections.slice(0, MAX_SECTIONS).map((s, i) => ({ ...s, id: slug(s.id, i) }));
  const ids = new Set();
  plan.sections.forEach((s, i) => { if (ids.has(s.id)) s.id = `${s.id}-${i + 1}`; ids.add(s.id); });
  emit({ agent: "lead", kind: "done", label: "Plans the page", text: `Split the job into ${plan.sections.length} parts: ${plan.sections.map((s) => s.heading).join(", ")}.`, crew: plan.sections.map((s) => ({ id: s.id, role: s.role, heading: s.heading })) });

  const parts = {};
  await Promise.all(plan.sections.map((s) => work(`part:${s.id}`, s.role, async () => {
    parts[s.id] = await model({ role: "specialist", system: SPECIALIST, user: specialistMessage(request, plan, s), schema: PartSchema, effort: "medium" });
    return parts[s.id];
  }, (p) => `Drafted ${s.heading.toLowerCase()}${p.table.rows.length ? ` with a ${p.table.rows.length}-row table` : ""}.`)));

  const review = await work("reviewer", "Checks every part", () => model({
    role: "reviewer", system: REVIEWER, user: draftMessage(request, plan, parts), schema: ReviewSchema, effort: "high",
  }), (r) => {
    const sent = r.parts.filter((p) => p.verdict === "revise" && parts[p.id]).slice(0, MAX_REVISIONS);
    return sent.length ? `Sent ${sent.length} part${sent.length > 1 ? "s" : ""} back: ${sent.map((p) => plan.sections.find((s) => s.id === p.id)?.heading).join(", ")}.${r.conflicts.length ? ` Found ${r.conflicts.length} conflict${r.conflicts.length > 1 ? "s" : ""}.` : ""}`
      : `Passed every part.${r.conflicts.length ? ` Found ${r.conflicts.length} conflict${r.conflicts.length > 1 ? "s" : ""} for the editor.` : ""}`;
  });

  const revise = review.parts.filter((p) => p.verdict === "revise" && parts[p.id] && p.notes.length).slice(0, MAX_REVISIONS);
  const revised = {};
  await Promise.all(revise.map((r) => {
    const s = plan.sections.find((x) => x.id === r.id);
    emit({ agent: `part:${s.id}`, kind: "note", label: s.role, text: r.notes[0] });
    return work(`part:${s.id}`, s.role, async () => {
      parts[s.id] = await model({ role: "specialist", system: REVISER, user: specialistMessage(request, plan, s, { notes: r.notes, draft: parts[s.id] }), schema: PartSchema, effort: "medium" });
      revised[s.id] = r.notes;
      return parts[s.id];
    }, () => `Revised ${s.heading.toLowerCase()} after review.`);
  }));

  const page = await work("editor", "Assembles the page", () => model({
    role: "editor", system: EDITOR,
    user: `${draftMessage(request, plan, parts)}\n\nConflicts the reviewer found:\n${review.conflicts.length ? review.conflicts.map((c) => `- ${c}`).join("\n") : "- none"}`,
    schema: PageSchema, effort: "medium",
  }), (p) => `Assembled ${p.sections.length} sections, a summary and ${p.next_steps.length} next steps.`);

  const sections = plan.sections.map((s) => {
    const final = page.sections.find((x) => x.id === s.id) || { heading: s.heading, ...parts[s.id] };
    return { id: s.id, role: s.role, heading: final.heading || s.heading, body: final.body, table: final.table, revised: revised[s.id] || null };
  });

  return {
    request,
    title: plan.title,
    goal: plan.goal,
    summary: page.summary,
    sections,
    next_steps: page.next_steps,
    assumptions: page.assumptions.length ? page.assumptions : plan.assumptions,
    checks: plan.checks,
    conflicts: review.conflicts,
    calls: 2 + plan.sections.length + revise.length + 1,
    prompt: PROMPT_VERSION,
    events,
  };
}
