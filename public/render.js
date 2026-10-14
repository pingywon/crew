export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const nameOf = (agent, crew) => {
  if (agent === "lead") return ["Lead", "Plans the page"];
  if (agent === "reviewer") return ["Reviewer", "Checks every part"];
  if (agent === "editor") return ["Editor", "Assembles the page"];
  const part = crew.find((c) => `part:${c.id}` === agent);
  return part ? [part.role, part.heading] : [agent, ""];
};

// The run timeline: one lane per agent, bars to scale, a log of what each one did.
export function room({ title = "The run", recorded = true } = {}) {
  let events = [];
  let crew = [];
  let lanes = new Map();
  const lanesEl = h("div", { class: "lanes" });
  const axisEnd = h("span", {}, "");
  const logEl = h("ol", { class: "log", "aria-live": "polite" });
  const summary = h("p", {}, recorded ? "A recorded run" : "Working now");
  const replayBtn = h("button", { type: "button", class: "btn quiet", hidden: !recorded }, "Replay the run");
  const el = h("section", { class: "room", "aria-label": "How the crew worked" },
    h("div", { class: "room-head" }, h("h2", {}, title), summary),
    lanesEl,
    h("div", { class: "lanes" }, h("span", { class: "lane-label", "aria-hidden": "true" }), h("div", { class: "axis" }, h("span", {}, "0:00"), axisEnd)),
    h("div", { class: "controls" },
      replayBtn,
      h("p", { class: "key" }, h("span", {}, h("i", { class: "a" }), "Lead and editor"), h("span", {}, h("i"), "Specialists and reviewer"), h("span", {}, h("i", { class: "r" }), "Revision")),
    ),
    logEl,
  );

  function laneFor(agent) {
    if (lanes.has(agent)) return lanes.get(agent);
    const [who, what] = nameOf(agent, crew);
    const track = h("div", { class: "track", role: "img", "aria-label": `${who} timeline` });
    const label = h("div", { class: "lane-label" }, h("b", {}, who), what);
    const lane = { track, label, spans: [] };
    lanes.set(agent, lane);
    return lane;
  }

  function layout() {
    const order = ["lead", ...crew.map((c) => `part:${c.id}`), "reviewer", "editor"];
    lanesEl.replaceChildren(...order.flatMap((a) => { const l = laneFor(a); return [l.label, l.track]; }));
  }

  function build(list) {
    events = list;
    crew = (list.find((e) => e.crew) || {}).crew || crew;
    lanes = new Map();
    layout();
    const open = new Map();
    for (const e of list) {
      const lane = laneFor(e.agent);
      if (e.kind === "start") {
        const span = { start: e.t, end: null, revision: lane.spans.length > 0, el: h("span", { class: `span ${e.agent === "lead" || e.agent === "editor" ? e.agent : ""}` }) };
        if (span.revision) span.el.classList.add("revision");
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
        h("time", {}, clock(e.t)),
        h("span", {}, h("b", {}, e.kind === "note" ? "Reviewer to " : ""), h("b", {}, e.kind === "note" ? who : who), `: ${e.kind === "note" ? `“${e.text}”` : e.text}`));
    }));
  }

  // Shows the run as it stood at time `now` (ms), on a scale of `total` ms.
  function draw(now, total) {
    const span = Math.max(total, 1);
    for (const lane of lanes.values()) {
      for (const s of lane.spans) {
        const visible = s.start <= now;
        s.el.hidden = !visible;
        if (!visible) continue;
        const end = Math.min(s.end ?? now, now);
        s.el.style.left = `${(s.start / span) * 100}%`;
        s.el.style.width = `${(Math.max(0, end - s.start) / span) * 100}%`;
        s.el.classList.toggle("working", s.end == null || s.end > now);
      }
    }
    for (const li of logEl.children) li.hidden = Number(li.dataset.t) > now;
    axisEnd.textContent = clock(total);
  }

  function show(list) {
    build(list);
    const total = Math.max(...list.map((e) => e.t), 1);
    draw(total, total);
    const parts = crew.length;
    const revisions = list.filter((e) => e.kind === "note").length;
    summary.textContent = `${parts + 3} agents, ${clock(total)} total${revisions ? `, ${revisions} sent back` : ""}`;
  }

  let raf = 0;
  function replay(seconds = 9) {
    cancelAnimationFrame(raf);
    const total = Math.max(...events.map((e) => e.t), 1);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return draw(total, total);
    const startedAt = performance.now();
    const tick = (nowMs) => {
      const sim = Math.min(total, ((nowMs - startedAt) / (seconds * 1000)) * total);
      draw(sim, total);
      if (sim < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  replayBtn.addEventListener("click", () => replay());

  // Live runs: add events as they arrive and keep the clock moving.
  let liveTimer = 0;
  const liveStart = performance.now();
  function push(e) {
    events = [...events, e];
    build(events);
  }
  function startLive() {
    const tick = () => {
      const now = performance.now() - liveStart;
      draw(now, Math.max(now, 30_000));
      summary.textContent = `Working now, ${clock(now)}`;
    };
    liveTimer = setInterval(tick, 250);
    tick();
  }
  function stopLive() { clearInterval(liveTimer); }

  return { el, show, replay, push, startLive, stopLive };
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
    h("table", {},
      h("thead", {}, h("tr", {}, t.columns.map((c) => h("th", { scope: "col" }, c)))),
      h("tbody", {}, t.rows.map((r) => h("tr", {}, t.columns.map((_, i) => h("td", {}, r[i] ?? ""))))),
    ));
}

export function renderRun(root, { run, meta, source, team }) {
  root.replaceChildren(
    h("a", { class: "back", href: "#" }, "New job"),
    h("blockquote", { class: "job-quote" }, run.request),
    h("h1", {}, run.title),
    h("p", { class: "goal" }, run.goal),
  );
  const grid = h("div", { class: "result-grid" });
  if (team) grid.append(team.el);
  const doc = h("article", { class: "doc" },
    h("p", { class: "summary" }, run.summary),
    run.sections.map((s) => h("section", {},
      h("h2", {}, s.heading),
      h("p", { class: "byline" }, `Written by the ${s.role.toLowerCase()}.`, s.revised ? h("span", { class: "rev" }, ` Revised after review: “${s.revised[0]}”`) : null),
      blocks(s.body),
      table(s.table),
    )),
    h("section", {}, h("h2", { class: "small" }, "Next steps"), h("ol", {}, run.next_steps.map((n) => h("li", {}, n)))),
    h("section", {}, h("h2", { class: "small" }, "Assumed"), h("ul", {}, run.assumptions.map((a) => h("li", {}, a)))),
    h("section", { class: "checks" }, h("h2", { class: "small" }, "The lead's checks"), h("ul", {}, run.checks.map((c) => h("li", {}, c)))),
  );
  grid.append(doc);
  root.append(grid, h("p", { class: "fine" }, `${source === "sample" ? "A recorded run. " : ""}Written by Claude in ${run.calls} model calls. Prices and figures are estimates; check them where you live.`));
}
