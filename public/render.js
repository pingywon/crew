import { h, icon } from "./kit.js";

export const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const nameOf = (agent, crew) => {
  if (agent === "lead") return ["Lead", "Plans"];
  if (agent === "reviewer") return ["Reviewer", "Checks"];
  if (agent === "editor") return ["Editor", "Assembles"];
  const part = crew.find((c) => `part:${c.id}` === agent);
  return part ? [part.role, part.heading] : [agent, ""];
};

// Timeline: one lane per agent, bars to scale, a collapsible log.
export function room({ title = "Timeline", recorded = true, wide = false } = {}) {
  let events = [];
  let crew = [];
  let lanes = new Map();
  const lanesEl = h("div", { class: "lanes" });
  const axisEnd = h("span", {}, "");
  const logEl = h("ol", { class: "log", "aria-live": "polite" });
  const summary = h("span", { class: "count" }, recorded ? "" : "Working");
  const replayBtn = h("button", { type: "button", class: "btn ghost sm", hidden: !recorded }, icon("play"), "Replay");
  const el = h("section", { class: `card room${wide ? " wide" : ""}`, "aria-label": "How the crew worked" },
    h("div", { class: "card-h" }, h("h2", {}, icon("clock"), `${title} `, summary), replayBtn),
    lanesEl,
    h("div", { class: "lanes" }, h("span", { class: "lane-label", "aria-hidden": "true" }), h("div", { class: "axis" }, h("span", {}, "0:00"), axisEnd)),
    h("p", { class: "key" }, h("span", {}, h("i", { class: "a" }), "Lead, editor"), h("span", {}, h("i"), "Specialists, reviewer"), h("span", {}, h("i", { class: "r" }), "Revision")),
    h("details", { class: "more" }, h("summary", {}, "Log"), logEl),
  );

  function laneFor(agent) {
    if (lanes.has(agent)) return lanes.get(agent);
    const [who, what] = nameOf(agent, crew);
    const lane = { track: h("div", { class: "track", role: "img", "aria-label": `${who} timeline` }), label: h("div", { class: "lane-label", title: `${who}: ${what}` }, h("b", {}, who), what ? ` ${what}` : ""), spans: [] };
    lanes.set(agent, lane);
    return lane;
  }

  function build(list) {
    events = list;
    crew = (list.find((e) => e.crew) || {}).crew || crew;
    lanes = new Map();
    const order = ["lead", ...crew.map((c) => `part:${c.id}`), "reviewer", "editor"];
    lanesEl.replaceChildren(...order.flatMap((a) => { const l = laneFor(a); return [l.label, l.track]; }));
    const open = new Map();
    for (const e of list) {
      const lane = laneFor(e.agent);
      if (e.kind === "start") {
        const span = { start: e.t, end: null, el: h("span", { class: `span${e.agent === "lead" || e.agent === "editor" ? ` ${e.agent}` : ""}${lane.spans.length ? " revision" : ""}` }) };
        lane.spans.push(span);
        lane.track.append(span.el);
        open.set(e.agent, span);
      } else if (e.kind === "done" && open.get(e.agent)) {
        open.get(e.agent).end = e.t;
        open.delete(e.agent);
      }
    }
    logEl.replaceChildren(...list.filter((e) => e.kind !== "start").map((e) => {
      const [who] = nameOf(e.agent, crew);
      return h("li", { class: e.kind === "note" ? "note" : "", "data-t": String(e.t) },
        h("time", {}, clock(e.t)), h("span", {}, h("b", {}, e.kind === "note" ? `Reviewer to ${who}` : who), `: ${e.kind === "note" ? `“${e.text}”` : e.text}`));
    }));
  }

  function draw(now, total) {
    const span = Math.max(total, 1);
    for (const lane of lanes.values()) {
      for (const s of lane.spans) {
        s.el.hidden = s.start > now;
        if (s.el.hidden) continue;
        const end = Math.min(s.end ?? now, now);
        s.el.style.left = `${(s.start / span) * 100}%`;
        s.el.style.width = `${(Math.max(0, end - s.start) / span) * 100}%`;
        s.el.classList.toggle("working", s.end == null || s.end > now);
      }
    }
    for (const li of logEl.children) li.hidden = Number(li.dataset.t) > now;
    axisEnd.textContent = clock(total);
  }

  const totalOf = () => Math.max(...events.map((e) => e.t), 1);
  function show(list) {
    build(list);
    draw(totalOf(), totalOf());
    summary.textContent = clock(totalOf());
  }

  let raf = 0;
  function replay(seconds = 8) {
    cancelAnimationFrame(raf);
    const total = totalOf();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return draw(total, total);
    const t0 = performance.now();
    const tick = (now) => {
      const sim = Math.min(total, ((now - t0) / (seconds * 1000)) * total);
      draw(sim, total);
      if (sim < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  replayBtn.addEventListener("click", () => replay());

  let timer = 0;
  const liveStart = performance.now();
  return {
    el, show, replay,
    push(e) { build([...events, e]); },
    startLive() {
      const tick = () => { const now = performance.now() - liveStart; draw(now, Math.max(now, 30_000)); summary.textContent = clock(now); };
      timer = setInterval(tick, 250);
      tick();
    },
    stopLive() { clearInterval(timer); },
  };
}

function blocks(list) {
  return list.map((b) => {
    if (b.kind === "p") return b.text ? h("p", {}, b.text) : null;
    const items = (b.items || []).filter(Boolean);
    return items.length ? h(b.kind === "ol" ? "ol" : "ul", {}, items.map((i) => h("li", {}, i))) : null;
  });
}

function table(t) {
  if (!t || !t.columns?.length || !t.rows?.length) return null;
  return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Table" },
    h("table", {}, h("thead", {}, h("tr", {}, t.columns.map((c) => h("th", { scope: "col" }, c)))),
      h("tbody", {}, t.rows.map((r) => h("tr", {}, t.columns.map((_, i) => h("td", {}, r[i] ?? "")))))));
}

const tile = (k, v, cls, ic) => h("div", { class: `tile ${cls || ""}` }, h("span", { class: "k" }, icon(ic), k), h("span", { class: "v" }, v));

export function renderRun(root, { run, source, team, onBack }) {
  const total = Math.max(...run.events.map((e) => e.t), 1);
  const revisions = run.sections.filter((s) => s.revised).length;
  root.replaceChildren(
    h("div", { class: "r-head" },
      h("div", { class: "bar" },
        h("button", { type: "button", class: "btn ghost sm", onclick: onBack }, icon("arrowLeft"), "New"),
        source === "sample" ? h("span", { class: "chip" }, "Sample") : h("span", { class: "chip ok" }, "Live"),
      ),
      h("h1", { class: "r-title" }, run.title),
      h("p", { class: "r-goal" }, run.goal),
      h("p", { class: "job" }, `Job: “${run.request}”`),
    ),
    h("div", { class: "tiles" },
      tile("Agents", String(run.sections.length + 3), "accent", "users"),
      tile("Time", clock(total), "", "clock"),
      tile("Sent back", String(revisions), revisions ? "accent" : "", "flag"),
      tile("Model calls", String(run.calls), "", "sparkle"),
    ),
  );
  if (team) root.append(team.el);
  root.append(h("section", { class: "card verdict" }, h("span", { class: "ic" }, icon("check")), h("div", {}, h("small", {}, "Bottom line"), h("p", {}, run.summary))));
  root.append(h("div", { class: "grid two" }, run.sections.map((s) => h("article", { class: "card part" },
    h("h3", {}, s.heading),
    h("div", { class: "chips" }, h("span", { class: "chip" }, s.role), s.revised ? h("span", { class: "chip accent" }, "Revised") : null),
    blocks(s.body),
    table(s.table),
    s.revised ? h("p", { class: "rev" }, `Reviewer: “${s.revised[0]}”`) : null,
  ))));
  root.append(h("div", { class: "grid two" },
    h("section", { class: "card" }, h("div", { class: "card-h" }, h("h2", {}, icon("check"), "Next steps")),
      h("ol", { class: "list checks plain" }, run.next_steps.map((n) => h("li", {}, n)))),
    h("section", { class: "card" }, h("div", { class: "card-h" }, h("h2", {}, icon("eye"), "Assumed")),
      h("ul", { class: "plain" }, run.assumptions.map((a) => h("li", {}, a)))),
  ));
  root.append(h("p", { class: "fine" }, `${source === "sample" ? "Recorded run. " : ""}Written by Claude in ${run.calls} model calls. Figures are estimates.`));
}
