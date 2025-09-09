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

/**
 * Helper: returns true when we should attempt streaming SSE.
 * Vercel's Node serverless functions buffer responses, so detect it and fallback.
 */
function platformSupportsStreaming(res) {
  // If Vercel is present, assume it buffers Node serverless responses.
  // If you deploy to a host that supports streaming (Render, self-hosted), unset VERCEL to enable SSE.
  if (process.env.VERCEL) return false;
  // If res.flushHeaders exists and writable, we can try streaming
  if (typeof res.flushHeaders === 'function' && typeof res.write === 'function') return true;
  return false;
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

  const canStream = platformSupportsStreaming(res);

  // If streaming is not available (e.g. Vercel), collect results and return JSON at end
  const collectedResponses = [];

  // SSE send helper (only used when canStream === true)
  if (canStream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // common helpful header to reduce buffering by proxies
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      try { res.flushHeaders(); } catch (e) { /* ignore */ }
    }
  }

  const sendEvent = (event, data) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    if (!canStream) return; // noop when not streaming
    res.write(`event: ${event}\n`);
    payload.split(/\n/).forEach(line => res.write(`data: ${line}\n`));
    res.write('\n');
  };

  let finished = 0;

  const processModel = async (id) => {
    if (isDeprecatedModelId(id)) {
      const skipped = { modelId: id, modelDisplay: id, error: true, message: 'deprecated', metrics: null };
      if (canStream) {
        sendEvent('model-skipped', { modelId: id, reason: 'deprecated' });
      } else {
        collectedResponses.push(skipped);
      }
      finished++;
      return;
    }

    const [provider, engine] = id.split(':');
    const key = cacheKey(provider, engine, query);
    const cached = cache.get(key);

    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      const result = cached.val;
      if (canStream) {
        sendEvent('model-start', { modelId: id, modelDisplay: result.modelDisplay, cached: true });
        const text = result.text || '';
        const chunkSize = 200;
        for (let i = 0; i < text.length; i += chunkSize) {
          sendEvent('model-chunk', { modelId: id, text: text.slice(i, i + chunkSize) });
        }
        sendEvent('model-end', { modelId: id, metrics: result.metrics });
      } else {
        collectedResponses.push({ ...result, cached: true });
      }
      finished++;
      return;
    }

    try {
      if (canStream) {
        sendEvent('model-start', { modelId: id, modelDisplay: `${provider}:${engine}`, cached: false });
      }

      const result = await callProvider(provider, engine, query);

      if (result?.error) {
        const errObj = { modelId: id, modelDisplay: `${provider}:${engine}`, error: true, message: result.message, status: result.status ?? null, body: result.body ?? null };
        if (canStream) {
          sendEvent('model-error', errObj);
        } else {
          collectedResponses.push(errObj);
        }
      } else {
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

        // cache
        cache.set(key, { ts: Date.now(), val: out });

        if (canStream) {
          const chunkSize = 200;
          for (let i = 0; i < out.text.length; i += chunkSize) {
            sendEvent('model-chunk', { modelId: id, text: out.text.slice(i, i + chunkSize) });
          }
          sendEvent('model-end', { modelId: id, metrics: out.metrics });
        } else {
          collectedResponses.push(out);
        }
      }
    } catch (err) {
      const errObj = { modelId: id, modelDisplay: `${provider}:${engine}`, error: true, message: err.message || String(err) };
      console.error(`Error processing model ${id}:`, err);
      if (canStream) {
        sendEvent('model-error', errObj);
      } else {
        collectedResponses.push(errObj);
      }
    }

    finished++;
  };

  try {
    // Launch processing with concurrency
    await Promise.all(selected.map(id => concurrency(() => processModel(id))));
  } catch (err) {
    console.error('Stream handler error:', err);
    if (!canStream && !res.headersSent) {
      return res.status(500).json({ error: 'internal_error', message: 'An error occurred while processing your request' });
    }
    if (canStream && !res.headersSent) {
      sendEvent('model-error', { message: 'internal_error' });
      sendEvent('done', { ok: false });
      res.end();
      return;
    }
  }

  // all done
  if (canStream) {
    sendEvent('done', { ok: true });
    res.end();
    return;
  } else {
    // Return aggregated JSON payload identical shape to non-streaming API
    return res.status(200).json({ responses: collectedResponses });
  }
}
