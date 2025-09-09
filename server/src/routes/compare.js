import express from 'express';
import { callOpenAI, callAnthropic, concurrencyLimit as providerLimit } from '../services/providerClients.js';

const router = express.Router();

// in-memory cache (dev)
const CACHE_TTL_MS = 1000 * 60 * 30;
const cache = new Map();
function cacheKey(provider, engine, query) {
  return `${provider}:${engine}:${Buffer.from(query).toString('base64')}`;
}

function isDeprecatedModelId(modelId) {
  const raw = process.env.DEPRECATED_MODELS || '';
  const set = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  if (set.has(modelId)) return true;
  if (/deprecated|deprecat|end[\s-]?of[\s-]?life|eol|retired|obsolete/i.test(modelId)) return true;
  return false;
}

async function callProvider(provider, engine, query) {
  if (provider === 'openai') return await callOpenAI(engine, query);
  if (provider === 'anthropic') return await callAnthropic(engine, query);
  return { error: true, message: 'unsupported provider: ' + provider };
}

// POST /api/compare => JSON result with per-model errors surfaced
router.post('/', async (req, res, next) => {
  try {
    const { query, modelIds } = req.body;
    if (!query || !Array.isArray(modelIds) || modelIds.length === 0) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    const selected = modelIds.slice(0, 3);

    const tasks = selected.map(id => async () => {
      if (isDeprecatedModelId(id)) {
        return { modelId: id, error: true, message: 'model deprecated or marked deprecated' };
      }
      const [provider, engine] = id.split(':');
      const key = cacheKey(provider, engine, query);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        return { ...cached.val, cached: true };
      }
      const result = await callProvider(provider, engine, query);
      if (result?.error) {
        // return structured error for this model
        return { modelId: id, modelDisplay: `${provider}:${engine}`, error: true, message: result.message, status: result.status, body: result.body };
      }
      const out = { modelId: id, modelDisplay: `${provider}:${engine}`, text: result.text, metrics: { timeMs: result.timeMs ?? 0, length: result.text?.length ?? 0 }, raw: result.raw };
      cache.set(key, { ts: Date.now(), val: out });
      return out;
    });

    const results = await Promise.all(selected.map((_, i) => providerLimit(tasks[i])));
    res.json({ responses: results });
  } catch (err) {
    next(err);
  }
});

export default router;