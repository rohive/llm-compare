import pLimit from 'p-limit';

export const concurrencyLimit = pLimit(3);

function safeJsonOrText(res) {
  return res.text().then(txt => {
    try { return JSON.parse(txt); } catch { return txt; }
  }).catch(() => null);
}

// Helper: extract text from various Anthropic response shapes
function extractAnthropicText(resp) {
  if (!resp) return '';
  // 1) direct fields
  if (typeof resp === 'string') return resp;
  if (resp.completion && typeof resp.completion === 'string') return resp.completion;
  // 2) message.content could be string or object
  if (resp.message && resp.message.content) {
    // content may be a string or array of blocks
    const c = resp.message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c.map(block => (block && block.text) ? block.text : (typeof block === 'string' ? block : '')).join('');
    }
  }
  // 3) raw content array: [{type:'text', text:'...'}, ...]
  if (Array.isArray(resp.content)) {
    return resp.content.map(item => (item && item.type === 'text' && item.text) ? item.text : '').join('');
  }
  // 4) fallback: look for any nested text fields
  if (resp.output && typeof resp.output === 'string') return resp.output;
  // no text found
  return '';
}

export async function callOpenAI(model, prompt, opts = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: true, message: 'OPENAI_API_KEY not set' };

  // Try SDK if installed
  try {
    const mod = await import('openai').catch(() => null);
    const OpenAI = mod?.default ?? mod;
    if (OpenAI) {
      const client = new OpenAI({ apiKey: key });
      const start = Date.now();
      const resp = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: opts.max_tokens ?? 512,
        temperature: opts.temperature ?? 0.2
      });
      const timeMs = Date.now() - start;
      const text = resp?.choices?.[0]?.message?.content ?? (resp.output_text ?? '');
      return { text, timeMs, raw: resp };
    }
  } catch (err) {
    console.warn('OpenAI SDK call failed, falling back to REST:', err?.message || err);
  }

  // Fallback REST
  try {
    const fetchMod = await import('node-fetch');
    const fetch = fetchMod?.default ?? fetchMod;
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
    const text = json.choices?.[0]?.message?.content ?? '';
    return { text, timeMs, raw: json };
  } catch (err) {
    return { error: true, message: err?.message || String(err) };
  }
}

export async function callAnthropic(model, prompt, opts = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: true, message: 'ANTHROPIC_API_KEY not set' };

  // Try SDK first (recommended)
  try {
    const mod = await import('@anthropic-ai/sdk').catch(() => null);
    const Anthropic = mod?.default ?? mod;
    if (Anthropic) {
      const client = new Anthropic({ apiKey: key });
      const start = Date.now();
      let resp = null;
      if (client.messages && typeof client.messages.create === 'function') {
        resp = await client.messages.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts.max_tokens ?? 512,
          temperature: opts.temperature ?? 0.2
        });
      } else if (client.completions && typeof client.completions.create === 'function') {
        resp = await client.completions.create({
          model,
          prompt,
          max_tokens_to_sample: opts.max_tokens ?? 512,
          temperature: opts.temperature ?? 0.2
        });
      } else if (typeof client === 'function') {
        resp = await client(model, { prompt });
      }
      const timeMs = Date.now() - start;
      const text = extractAnthropicText(resp);
      return { text, timeMs, raw: resp };
    }
  } catch (err) {
    console.warn('Anthropic SDK call failed, falling back to REST:', err?.message || err);
  }

  // Fallback REST — include both max_tokens and max_tokens_to_sample for compatibility
  try {
    const fetchMod = await import('node-fetch');
    const fetch = fetchMod?.default ?? fetchMod;
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