/**
 * AI provider for server functions: Anthropic Claude via the AI SDK.
 * Configure ANTHROPIC_API_KEY (required) and ANTHROPIC_MODEL (optional).
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { env } from "./env.ts";

export const AI_MODEL = env("ANTHROPIC_MODEL") ?? "claude-sonnet-4-5";

export function aiConfigured(): boolean {
  return !!env("ANTHROPIC_API_KEY");
}

export function anthropicModel(model = AI_MODEL) {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  return createAnthropic({ apiKey })(model);
}

/** Plain text completion (Messages API) for simple prompt → text calls. */
export async function completeText(opts: { system?: string; prompt: string; maxTokens?: number; model?: string }): Promise<string> {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? AI_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    }),
  });
  if (res.status === 429) throw Object.assign(new Error("AI rate limited"), { status: 429 });
  if (!res.ok) throw Object.assign(new Error(`AI request failed: ${res.status} ${await res.text()}`), { status: res.status });
  const json = (await res.json()) as { content: { type: string; text?: string }[] };
  return json.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}
