import fetch from 'node-fetch';

// Simple safe provider helpers for serverless functions
export async function callOpenAI(model, prompt, opts = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: true, message: 'OPENAI_API_KEY not set' };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: opts.max_tokens ?? 512,
        temperature: opts.temperature ?? 0.2
      })
    });
    const body = await res.text();
    const json = (() => { try { return JSON.parse(body); } catch { return body; } })();
    if (!res.ok) return { error: true, message: `OpenAI REST error ${res.status}`, status: res.status, body: json };
    const text = json.choices?.[0]?.message?.content ?? (json.output_text ?? '');
    return { text, timeMs: 0, raw: json };
  } catch (err) {
    return { error: true, message: err?.message || String(err) };
  }
}

function extractAnthropicText(resp) {
  if (!resp) return '';
  if (typeof resp === 'string') return resp;
  if (resp.completion && typeof resp.completion === 'string') return resp.completion;
  if (resp.message && resp.message.content) {
    const c = resp.message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(b => (b && b.text) ? b.text : (typeof b === 'string' ? b : '')).join('');
  }
  if (Array.isArray(resp.content)) return resp.content.map(i => (i && i.type === 'text' && i.text) ? i.text : '').join('');
  return '';
}

export async function callAnthropic(model, prompt, opts = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: true, message: 'ANTHROPIC_API_KEY not set' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: opts.max_tokens ?? 512,
        max_tokens_to_sample: opts.max_tokens ?? 512,
        temperature: opts.temperature ?? 0.2
      })
    });
    const body = await res.text();
    const json = (() => { try { return JSON.parse(body); } catch { return body; } })();
    if (!res.ok) return { error: true, message: `Anthropic REST error ${res.status}`, status: res.status, body: json };
    const text = extractAnthropicText(json);
    return { text, timeMs: 0, raw: json };
  } catch (err) {
    return { error: true, message: err?.message || String(err) };
  }
}
