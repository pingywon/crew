import { runCrew, MIN_CHARS, MAX_CHARS } from "./crew/pipeline.js";
import { apiModel, engineReady, EngineError, MODEL } from "./crew/engine.js";
import { PROMPT_VERSION } from "./crew/prompts.js";
import { takeDailyAllowance, visitorId } from "./limits.js";
import { VERSION } from "./version.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const problem = (code, message, status) => json({ error: { code, message } }, status);

export const live = (env) => engineReady(env) || env.MOCK_ENGINE === "1";

async function handleJob(request, env, ctx, deps) {
  if (!live(env)) return problem("engine_off", "Live jobs are paused. The samples show full runs.", 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return problem("bad_request", "Send JSON: { \"job\": \"...\" }.", 400);
  }
  const job = typeof body?.job === "string" ? body.job.replace(/\r\n?/g, "\n").trim() : "";
  if (job.length < MIN_CHARS) return problem("too_short", "Describe the job in a sentence or two.", 400);
  if (job.length > MAX_CHARS) return problem("too_long", `Keep the job under ${MAX_CHARS.toLocaleString("en-US")} characters.`, 400);

  const allowance = await takeDailyAllowance(env.CREW_KV, {
    bucket: "job",
    visitor: await visitorId(request, env.IP_SALT),
    perVisitor: Number(env.JOBS_PER_VISITOR || 2),
    perDay: Number(env.JOBS_PER_DAY || 20),
  });
  if (!allowance.ok) return problem("limit", "That is today's limit for live jobs. The samples are always open.", 429);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (event, data) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const work = (async () => {
    try {
      const run = await runCrew(job, { model: deps.model || apiModel(env), onEvent: (e) => send("step", e) });
      await send("result", { run, meta: { version: VERSION, model: MODEL, generated_at: new Date().toISOString() } });
    } catch (err) {
      const known = err instanceof EngineError;
      await send("failure", { code: known ? err.code : "server", message: known ? err.message : "Something went wrong. Try again." });
    } finally {
      await writer.close();
    }
  })();
  ctx?.waitUntil?.(work);
  return new Response(readable, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export function route(request, env, ctx, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api/meta" && request.method === "GET") {
    return json({ version: VERSION, live: live(env), model: MODEL, prompt: PROMPT_VERSION });
  }
  if (url.pathname === "/api/job") {
    if (request.method !== "POST") return problem("method", "Use POST.", 405);
    return handleJob(request, env, ctx, deps);
  }
  if (url.pathname.startsWith("/api/")) return problem("not_found", "No such endpoint.", 404);
  return null;
}
