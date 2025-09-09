import { callOpenAI, callAnthropic } from './providerClients.js';

function cacheKey(provider, engine, query) {
  return `${provider}:${engine}:${Buffer.from(query).toString('base64')}`;
}
const CACHE_TTL_MS = 1000 * 60 * 30;
const cache = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const { query, modelIds } = req.body || {};
  if (!query || !Array.isArray(modelIds) || modelIds.length === 0) return res.status(400).json({ error: 'invalid_input' });

  const selected = modelIds.slice(0, 3);

  const results = await Promise.all(selected.map(async (id) => {
    try {
      const [provider, engine] = id.split(':');
      const key = cacheKey(provider, engine, query);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return { ...cached.val, cached: true };

      let result;
      if (provider === 'openai') result = await callOpenAI(engine, query);
      else if (provider === 'anthropic') result = await callAnthropic(engine, query);
      else result = { error: true, message: 'unsupported provider' };

      if (result?.error) return { modelId: id, modelDisplay: `${provider}:${engine}`, error: true, message: result.message, status: result.status, body: result.body ?? null };
      const out = { modelId: id, modelDisplay: `${provider}:${engine}`, text: result.text ?? '', metrics: { timeMs: result.timeMs ?? 0, length: (result.text ?? '').length }, raw: result.raw ?? null };
      cache.set(key, { ts: Date.now(), val: out });
      return out;
    } catch (err) {
      return { modelId: id, error: true, message: err?.message || String(err) };
    }
  }));

  res.status(200).json({ responses: results });
}
