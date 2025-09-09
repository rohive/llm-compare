import { callOpenAI, callAnthropic } from './providerClients.js';

// Use a simple concurrency limiter implementation
const createConcurrencyLimiter = (concurrency) => {
  const queue = [];
  let running = 0;

  const next = () => {
    if (running >= concurrency || !queue.length) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        running--;
        next();
      });
  };

  return (fn) => {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
};

const concurrency = createConcurrencyLimiter(3);
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
  if (!engine) {
    throw new Error('Invalid model ID format. Expected format: provider:engine');
  }
  if (provider === 'openai') return await callOpenAI(engine, query);
  if (provider === 'anthropic') return await callAnthropic(engine, query);
  return { error: true, message: 'unsupported provider: ' + provider };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { query, modelIds } = req.body || {};
  if (!query || !Array.isArray(modelIds) || modelIds.length === 0) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const selected = modelIds.slice(0, 3);

  const tasks = selected.map(id => concurrency(async () => {
    if (isDeprecatedModelId(id)) {
      return { modelId: id, error: true, message: 'model deprecated or marked deprecated' };
    }

    const [provider, engine] = id.split(':');
    const key = cacheKey(provider, engine, query);
    const cached = cache.get(key);
    
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { ...cached.val, cached: true };
    }

    try {
      const result = await callProvider(provider, engine, query);
      
      if (result?.error) {
        return { 
          modelId: id, 
          modelDisplay: `${provider}:${engine}`, 
          error: true, 
          message: result.message || 'error', 
          status: result.status || null, 
          body: result.body || null 
        };
      }

      const out = {
        modelId: id,
        modelDisplay: `${provider}:${engine}`,
        text: result.text || '',
        metrics: { 
          timeMs: result.timeMs || 0, 
          length: (result.text || '').length 
        },
        raw: result.raw || null
      };
      
      cache.set(key, { ts: Date.now(), val: out });
      return out;
      
    } catch (err) {
      console.error(`Error processing model ${id}:`, err);
      return { 
        modelId: id, 
        modelDisplay: id, 
        error: true, 
        message: err.message || String(err) 
      };
    }
  }));

  try {
    const results = await Promise.all(tasks);
    return res.status(200).json({ responses: results });
  } catch (err) {
    console.error('Compare handler error:', err);
    return res.status(500).json({ 
      error: 'internal_error', 
      message: 'An error occurred while processing your request' 
    });
  }
}
