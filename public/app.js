import { h, room, renderRun } from "./render.js";

const landing = document.getElementById("landing");
const view = document.getElementById("result-view");
const form = document.getElementById("job-form");
const text = document.getElementById("job-text");
const btn = document.getElementById("job-btn");
const notice = document.getElementById("form-notice");

let meta = { live: false };
const metaReady = fetch("api/meta").then((r) => (r.ok ? r.json() : meta)).then((m) => (meta = m)).catch(() => meta);
const session = {
  get() { try { return JSON.parse(sessionStorage.getItem("crew:last") || "null"); } catch { return null; } },
  set(v) { try { sessionStorage.setItem("crew:last", JSON.stringify(v)); } catch { /* fine without it */ } },
};
const say = (m, kind) => { notice.textContent = m; notice.classList.toggle("error", kind === "error"); notice.hidden = !m; };

let samples = [];
async function loadSamples() {
  samples = await (await fetch("samples/index.json")).json();
  document.getElementById("sample-list").replaceChildren(...samples.map((s) => h("li", {},
    h("button", { type: "button", onclick: () => (location.hash = `#sample/${s.id}`) }, h("strong", {}, s.label), h("span", {}, s.kind)),
  )));
  const first = samples[0];
  if (!first) return;
  const record = await (await fetch(`samples/${first.id}.json`)).json();
  const r = room({ title: `A real run: ${first.label.toLowerCase()}`, recorded: true });
  r.show(record.run.events);
  r.el.append(h("p", { class: "hint" }, h("a", { href: `#sample/${first.id}` }, "Read the finished page")));
  document.getElementById("hero-room").replaceChildren(r.el);
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) r.replay(6);
}

function showLanding() {
  view.hidden = true;
  view.replaceChildren();
  landing.hidden = false;
  document.title = "Crew";
}

function showRun(record, source) {
  landing.hidden = true;
  view.hidden = false;
  const team = room({ title: "How the crew worked", recorded: true });
  renderRun(view, { run: record.run, meta: record.meta, source, team });
  team.show(record.run.events);
  document.title = `${record.run.title} | Crew`;
  window.scrollTo(0, 0);
}

async function readEvents(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = chunk.match(/^event: (.+)$/m)?.[1];
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const job = text.value.trim();
  if (job.length < 20) return say("Describe the job in a sentence or two.", "error");
  await metaReady;
  if (!meta.live) return say("Live jobs are paused right now. Open a finished job below to see a full run.", "error");

  btn.disabled = true;
  say("");
  landing.hidden = true;
  view.hidden = false;
  const team = room({ title: "The crew is working", recorded: false });
  view.replaceChildren(h("a", { class: "back", href: "#" }, "New job"), h("blockquote", { class: "job-quote" }, job), h("h1", {}, "Working on it…"), team.el);
  team.startLive();
  window.scrollTo(0, 0);
  try {
    const res = await fetch("api/job", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job }) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || "Something went wrong. Try again.");
    }
    let result = null;
    let failure = null;
    await readEvents(res, (event, data) => {
      if (event === "step") team.push(data);
      else if (event === "result") result = data;
      else if (event === "failure") failure = data;
    });
    team.stopLive();
    if (failure) throw new Error(failure.message);
    if (!result) throw new Error("The crew did not finish. Try again.");
    session.set(result);
    if (location.hash === "#job") route();
    else location.hash = "#job";
  } catch (err) {
    team.stopLive();
    location.hash = "";
    showLanding();
    say(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

async function route() {
  const sample = location.hash.match(/^#sample\/([\w-]+)$/);
  if (sample) {
    try {
      const res = await fetch(`samples/${sample[1]}.json`);
      if (!res.ok) throw new Error();
      return showRun(await res.json(), "sample");
    } catch {
      location.hash = "";
      return showLanding();
    }
  }
  if (location.hash === "#job") {
    const last = session.get();
    if (last) return showRun(last, "live");
  }
  showLanding();
}

document.querySelectorAll("[data-home]").forEach((a) => a.addEventListener("click", (e) => {
  e.preventDefault();
  if (location.hash) location.hash = "";
  else showLanding();
}));
window.addEventListener("hashchange", route);
loadSamples().catch(() => {});
route();
