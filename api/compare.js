import pLimit from 'p-limit';
import { callOpenAI, callAnthropic } from './providerClients.js';

const concurrency = pLimit(3);
const CACHE_TTL_MS = 1000 * 60 * 30;
const cache = new Map();

function cacheKey(provider, engine, query) {
  return `${provider}:${engine}:${Buffer.from(query).toString('base64')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { query, modelIds } = req.body || {};
  if (!query || !Array.isArray(modelIds) || modelIds.length === 0) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const selected = modelIds.slice(0, 3);

  const tasks = selected.map(id => concurrency(async () => {
    const [provider, engine] = id.split(':');
    const key = cacheKey(provider, engine, query);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return { ...cached.val, cached: true };

    try {
      let result;
      if (provider === 'openai') result = await callOpenAI(engine, query);
      else if (provider === 'anthropic') result = await callAnthropic(engine, query);
      else result = { error: true, message: 'unsupported provider' };

      if (result?.error) {
        return { modelId: id, modelDisplay: `${provider}:${engine}`, error: true, message: result.message ?? 'error', status: result.status ?? null, body: result.body ?? null };
      }
      const out = {
        modelId: id,
        modelDisplay: `${provider}:${engine}`,
        text: result.text ?? '',
        metrics: { timeMs: result.timeMs ?? 0, length: (result.text ?? '').length },
        raw: result.raw ?? null
      };
      cache.set(key, { ts: Date.now(), val: out });
      return out;
    } catch (err) {
      return { modelId: id, modelDisplay: id, error: true, message: String(err) };
    }
  }));

  try {
    const results = await Promise.all(tasks);
    return res.status(200).json({ responses: results });
  } catch (err) {
    console.error('compare handler error', err);
    return res.status(500).json({ error: 'internal_error', message: String(err) });
  }
}
