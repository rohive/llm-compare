import { callOpenAI, callAnthropic } from './providerClients.js';

// Simple concurrency limiter
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { query, modelIds } = req.body || {};
  if (!query || !Array.isArray(modelIds) || modelIds.length === 0) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const selected = modelIds.slice(0, 3);
  
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let finished = 0;
  const sendEvent = (event, data) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\n`);
    payload.split(/\n/).forEach(line => res.write(`data: ${line}\n`));
    res.write('\n');
  };

  const processModel = async (id) => {
    if (isDeprecatedModelId(id)) {
      sendEvent('model-skipped', { modelId: id, reason: 'deprecated' });
      finished++;
      if (finished === selected.length) { 
        sendEvent('done', { ok: true }); 
        res.end(); 
      }
      return;
    }

    const [provider, engine] = id.split(':');
    const key = cacheKey(provider, engine, query);
    const cached = cache.get(key);

    // Handle cached response
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      const result = cached.val;
      sendEvent('model-start', { 
        modelId: id, 
        modelDisplay: result.modelDisplay, 
        cached: true 
      });
      
      // Stream the cached response in chunks
      const text = result.text || '';
      const chunkSize = 200;
      for (let i = 0; i < text.length; i += chunkSize) {
        sendEvent('model-chunk', { 
          modelId: id, 
          text: text.slice(i, i + chunkSize) 
        });
      }
      
      sendEvent('model-end', { 
        modelId: id, 
        metrics: result.metrics 
      });
      
      finished++;
      if (finished === selected.length) { 
        sendEvent('done', { ok: true }); 
        res.end(); 
      }
      return;
    }

    // Process new request
    try {
      sendEvent('model-start', { 
        modelId: id, 
        modelDisplay: `${provider}:${engine}`, 
        cached: false 
      });

      const result = await callProvider(provider, engine, query);

      if (result?.error) {
        sendEvent('model-error', {
          modelId: id,
          message: result.message,
          status: result.status,
          body: result.body
        });
      } else {
        // Cache the successful response
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
        
        // Stream the response in chunks
        const chunkSize = 200;
        for (let i = 0; i < out.text.length; i += chunkSize) {
          sendEvent('model-chunk', {
            modelId: id,
            text: out.text.slice(i, i + chunkSize)
          });
        }
        
        sendEvent('model-end', {
          modelId: id,
          metrics: out.metrics
        });
      }
    } catch (err) {
      console.error(`Error processing model ${id}:`, err);
      sendEvent('model-error', {
        modelId: id,
        message: err.message || String(err)
      });
    }

    // Check if all models have finished
    finished++;
    if (finished === selected.length) {
      sendEvent('done', { ok: true });
      res.end();
    }
  };

  // Process all models with concurrency
  try {
    await Promise.all(selected.map(id => concurrency(() => processModel(id))));
  } catch (err) {
    console.error('Stream handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'internal_error',
        message: 'An error occurred while processing your request'
      });
    }
  }
}
