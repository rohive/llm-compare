/**
 * providerClients.js — use platform global fetch only.
 * Avoid node-fetch to prevent ESM/CommonJS issues on Vercel.
 */

function safeJsonOrText(res) {
  return res.text().then(txt => {
    try { return JSON.parse(txt); } catch { return txt; }
  }).catch(() => null);
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

function fetchAvailable() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  return null;
}

export async function callOpenAI(model, prompt, opts = {}) {
  const fetch = fetchAvailable();
  if (!fetch) return { error: true, message: 'fetch is not available in runtime. Use Node 18+ or add a fetch polyfill.' };

  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: true, message: 'OPENAI_API_KEY not set' };

  try {
    const start = Date.now();
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
    const timeMs = Date.now() - start;
    if (!res.ok) {
      const body = await safeJsonOrText(res);
      return { error: true, message: `OpenAI REST error ${res.status}`, status: res.status, body, timeMs };
    }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? (json.output_text ?? '');
    return { text, timeMs, raw: json };
  } catch (err) {
    return { error: true, message: err?.message || String(err) };
  }
}

export async function callAnthropic(model, prompt, opts = {}) {
  const fetch = fetchAvailable();
  if (!fetch) return { error: true, message: 'fetch is not available in runtime. Use Node 18+ or add a fetch polyfill.' };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: true, message: 'ANTHROPIC_API_KEY not set' };

  try {
    const start = Date.now();
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: opts.max_tokens ?? 512,
      max_tokens_to_sample: opts.max_tokens ?? 512,
      temperature: opts.temperature ?? 0.2
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const timeMs = Date.now() - start;
    if (!res.ok) {
      const respBody = await safeJsonOrText(res);
      return { error: true, message: `Anthropic REST error ${res.status}`, status: res.status, body: respBody, timeMs };
    }
    const json = await res.json();
    const text = extractAnthropicText(json);
    return { text, timeMs, raw: json };
  } catch (err) {
    return { error: true, message: err?.message || String(err) };
  }
}
