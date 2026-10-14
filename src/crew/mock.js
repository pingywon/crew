// Stand-in model for local runs and end-to-end tests (MOCK_ENGINE=1). Never set in production.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const part = (n) => ({
  body: [{ kind: "p", text: `Part ${n} answers its brief in plain words.`, items: [] }, { kind: "ul", text: "", items: ["First point", "Second point"] }],
  table: n === 1 ? { columns: ["Item", "Cost"], rows: [["Cabinets", "$8,000 to $10,000"], ["Counters", "$3,000 to $4,500"]] } : { columns: [], rows: [] },
  handoff: n === 1 ? "The total is $25,000." : "",
});

export async function mockModel({ role, system }) {
  await wait(role === "specialist" ? 220 : 120);
  if (role === "lead") {
    return {
      title: "Test page", goal: "Check the crew works.", assumptions: ["A test budget."],
      sections: [
        { id: "costs", heading: "Where the money goes", role: "Budget planner", brief: "Costs." },
        { id: "order", heading: "What to do first", role: "Project planner", brief: "Order." },
        { id: "risks", heading: "What can go wrong", role: "Risk checker", brief: "Risks." },
      ],
      checks: ["Costs add up."],
    };
  }
  if (role === "specialist") return system.includes("sent your part back") ? { ...part(2), handoff: "Revised." } : part(system.length % 2 ? 1 : 1);
  if (role === "reviewer") return { parts: [{ id: "costs", verdict: "ok", notes: [] }, { id: "order", verdict: "revise", notes: ["Put the permit before demolition."] }, { id: "risks", verdict: "ok", notes: [] }], conflicts: [] };
  return {
    summary: "A test summary.",
    sections: ["costs", "order", "risks"].map((id) => ({ id, heading: id === "costs" ? "Where the money goes" : id === "order" ? "What to do first" : "What can go wrong", ...part(id === "costs" ? 1 : 2) })),
    next_steps: ["Do the first thing.", "Then the next."],
    assumptions: ["A test budget."],
  };
}
