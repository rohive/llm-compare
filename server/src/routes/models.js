import express from 'express';
import fetch from 'node-fetch';
const router = express.Router();

const FALLBACK_MODELS = [
  { id: 'openai:gpt-4o-mini', provider: 'openai', engine: 'gpt-4o-mini', displayName: 'GPT-4o Mini', latest: true },
  { id: 'openai:gpt-4o', provider: 'openai', engine: 'gpt-4o', displayName: 'GPT-4o', latest: true },
  { id: 'anthropic:claude-2.1', provider: 'anthropic', engine: 'claude-2.1', displayName: 'Claude 2.1', latest: true }
];

// Build a Set from env (comma-separated values like "anthropic:claude-2.1,openai:gpt-3.5-turbo-0301")
function getDeprecatedSet() {
  const raw = process.env.DEPRECATED_MODELS || '';
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

function looksDeprecated(model) {
  if (!model) return false;
  const s = (model.displayName || model.engine || '').toLowerCase();
  if (!s) return false;
  // heuristic patterns that indicate deprecation/eol
  if (/deprecated|deprecat|end[\\s-]?of[\\s-]?life|eol|retired|obsolete/i.test(s)) return true;
  return false;
}

function filterDeprecated(models) {
  const deprecatedSet = getDeprecatedSet();
  return models.filter(m => {
    if (!m) return false;
    if (deprecatedSet.has(m.id)) return false;
    if (looksDeprecated(m)) return false;
    return true;
  });
}

async function fetchOpenAIModels() {
  const out = [];
  const key = process.env.OPENAI_API_KEY;
  if (!key) return out;
  try {
    let OpenAI;
    try { OpenAI = (await import('openai')).default || (await import('openai')); } catch { OpenAI = null; }
    if (OpenAI) {
      const client = new OpenAI({ apiKey: key });
      const list = await client.models.list();
      if (list?.data && Array.isArray(list.data)) {
        list.data.forEach(m => out.push({ id: `openai:${m.id}`, provider: 'openai', engine: m.id, displayName: m.id }));
      } else {
        try { for await (const m of list) out.push({ id: `openai:${m.id}`, provider: 'openai', engine: m.id, displayName: m.id }); } catch {}
      }
      return out;
    }
    const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 });
    if (!res.ok) return out;
    const j = await res.json();
    (j.data || []).forEach(m => out.push({ id: `openai:${m.id}`, provider: 'openai', engine: m.id, displayName: m.id }));
    return out;
  } catch (err) {
    console.warn('OpenAI models fetch failed:', err?.message || err);
    return out;
  }
}

async function fetchAnthropicModels() {
  const out = [];
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return out;
  try {
    let Anthropic;
    try { Anthropic = (await import('@anthropic-ai/sdk')).default || (await import('@anthropic-ai/sdk')); } catch { Anthropic = null; }
    if (Anthropic) {
      const client = new Anthropic({ apiKey: key });
      if (client.models && typeof client.models.list === 'function') {
        const list = await client.models.list();
        (list.data || []).forEach(m => out.push({ id: `anthropic:${m.id}`, provider: 'anthropic', engine: m.id, displayName: m.id }));
        return out;
      }
    }
    // REST fallback (include anthropic-version)
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      timeout: 15000
    });
    if (!res.ok) return out;
    const j = await res.json();
    const items = j.data || j.models || [];
    items.forEach(m => {
      const id = m.id || m.name || String(m);
      out.push({ id: `anthropic:${id}`, provider: 'anthropic', engine: id, displayName: id });
    });
    return out;
  } catch (err) {
    console.warn('Anthropic models fetch failed:', err?.message || err);
    return out;
  }
}

router.get('/', async (req, res) => {
  try {
    const [openaiRaw, anthropicRaw] = await Promise.all([fetchOpenAIModels(), fetchAnthropicModels()]);

    const openai = filterDeprecated(openaiRaw);
    const anthropics = filterDeprecated(anthropicRaw);

    res.json({ openai: openai || [], anthropics: anthropics || [] });
  } catch (err) {
    console.error('models route error:', err);
    res.status(500).json({ openai: [], anthropics: [] });
  }
});

export default router;