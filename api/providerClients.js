import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export async function callOpenAI(model, prompt, opts = {}) {
  if (!openai) return { error: true, message: "OPENAI_API_KEY not set" };
  try {
    const start = Date.now();
    const resp = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: opts.max_tokens ?? 512,
      temperature: opts.temperature ?? 0.2,
    });
    const timeMs = Date.now() - start;
    const text = resp.choices?.[0]?.message?.content ?? "";
    return { text, timeMs, raw: resp };
  } catch (err) {
    return { error: true, message: err.message, raw: err };
  }
}

export async function callAnthropic(model, prompt, opts = {}) {
  if (!anthropic) return { error: true, message: "ANTHROPIC_API_KEY not set" };
  try {
    const start = Date.now();
    const resp = await anthropic.messages.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: opts.max_tokens ?? 512,
      temperature: opts.temperature ?? 0.2,
    });
    const timeMs = Date.now() - start;
    const text = resp.content
      ?.filter(c => c.type === "text")
      .map(c => c.text)
      .join("") ?? "";
    return { text, timeMs, raw: resp };
  } catch (err) {
    return { error: true, message: err.message, raw: err };
  }
}
