/**
 * AI provider for server functions: Anthropic Claude through the official SDK.
 * Configure ANTHROPIC_API_KEY (required); ANTHROPIC_MODEL and ANTHROPIC_SCAN_MODEL (optional)
 * override the models below.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";

/** Invoice scanning (vision, hardest extraction). */
export const CLAUDE_MODEL = env("ANTHROPIC_SCAN_MODEL") ?? "claude-opus-5-5";

/** Everyday text features: journal account classification, Arabic translation. */
export const AI_MODEL = env("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";

/** Official Anthropic SDK client. */
export function claudeClient(): Anthropic {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("AI is not set up on this server (ANTHROPIC_API_KEY)");
  return new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
}

export function aiConfigured(): boolean {
  return !!env("ANTHROPIC_API_KEY");
}

/** An AI call that ended without a usable answer (refusal, cut off, or not matching the schema). */
export class AiOutputError extends Error {
  constructor(message: string, readonly reason: "refusal" | "max_tokens" | "invalid") {
    super(message);
  }
}

const textOf = (content: Anthropic.ContentBlock[]) =>
  content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

function checkStop(stop: string | null) {
  if (stop === "refusal") throw new AiOutputError("The AI declined this request", "refusal");
  if (stop === "max_tokens") throw new AiOutputError("The AI answer was too long and was cut off", "max_tokens");
}

/**
 * One prompt → a JSON object matching `schema` (structured outputs, so the reply is always
 * valid JSON of that shape); `parse` validates it once more on our side.
 */
export async function generateJson<T>(opts: {
  prompt: string;
  system?: string;
  schema: Record<string, unknown>;
  parse: (value: unknown) => T;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const response = await claudeClient().messages.create({
    model: opts.model ?? AI_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    ...(opts.system ? { system: opts.system } : {}),
    output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema: opts.schema } },
    messages: [{ role: "user", content: opts.prompt }],
  });
  checkStop(response.stop_reason);
  try {
    return opts.parse(JSON.parse(textOf(response.content)));
  } catch {
    throw new AiOutputError("The AI answer did not match the expected format", "invalid");
  }
}

/** Plain prompt → text, streamed (long replies; thinking counts toward maxTokens). */
export async function completeText(opts: {
  system?: string;
  prompt: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  model?: string;
}): Promise<string> {
  const message = await claudeClient().messages.stream({
    model: opts.model ?? AI_MODEL,
    max_tokens: opts.maxTokens ?? 32000,
    ...(opts.system ? { system: opts.system } : {}),
    output_config: { effort: opts.effort ?? "medium" },
    messages: [{ role: "user", content: opts.prompt }],
  }).finalMessage();
  checkStop(message.stop_reason);
  return textOf(message.content);
}
