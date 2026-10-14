import { z } from "zod";

const Block = z.object({
  kind: z.enum(["p", "ul", "ol"]),
  text: z.string().describe("For kind p. Empty for lists."),
  items: z.array(z.string()).describe("For kind ul or ol. Empty for paragraphs."),
});
const Table = z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) });

export const PlanSchema = z.object({
  title: z.string(),
  goal: z.string(),
  assumptions: z.array(z.string()),
  sections: z.array(z.object({ id: z.string(), heading: z.string(), role: z.string(), brief: z.string() })),
  checks: z.array(z.string()),
});

export const PartSchema = z.object({ body: z.array(Block), table: Table, handoff: z.string() });

export const ReviewSchema = z.object({
  parts: z.array(z.object({ id: z.string(), verdict: z.enum(["ok", "revise"]), notes: z.array(z.string()) })),
  conflicts: z.array(z.string()),
});

export const PageSchema = z.object({
  summary: z.string(),
  sections: z.array(z.object({ id: z.string(), heading: z.string(), body: z.array(Block), table: Table })),
  next_steps: z.array(z.string()),
  assumptions: z.array(z.string()),
});

export function jsonSchema(schema) {
  return z.toJSONSchema(schema, { target: "draft-7" });
}
