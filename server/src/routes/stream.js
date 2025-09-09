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

// SSE streaming endpoint
router.post('/', async (req, res, next) => {
  try {
    const { query, modelIds } = req.body;
    if (!query || !Array.isArray(modelIds) || modelIds.length === 0) {
      res.status(400).json({ error: 'invalid_input' });
      return;
    }
    const selected = modelIds.slice(0, 3);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let finished = 0;
    const sendEvent = (event, data) => {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      res.write(`event: ${event}\n`);
      payload.split(/\n/).forEach(line => res.write(`data: ${line}\n`));
      res.write('\n');
    };

    const tasks = selected.map(id => async () => {
      if (isDeprecatedModelId(id)) {
        sendEvent('model-skipped', { modelId: id, reason: 'deprecated' });
        finished++;
        if (finished === selected.length) { sendEvent('done', { ok: true }); res.end(); }
        return;
      }

      const [provider, engine] = id.split(':');
      const key = cacheKey(provider, engine, query);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        const result = cached.val;
        sendEvent('model-start', { modelId: id, modelDisplay: result.modelDisplay, cached: true });
        const text = result.text || '';
        const chunkSize = 200;
        for (let i = 0; i < text.length; i += chunkSize) {
          sendEvent('model-chunk', { modelId: id, text: text.slice(i, i + chunkSize) });
        }
        sendEvent('model-end', { modelId: id, metrics: result.metrics });
        finished++;
        if (finished === selected.length) { sendEvent('done', { ok: true }); res.end(); }
        return;
      }

      try {
        sendEvent('model-start', { modelId: id, modelDisplay: `${provider}:${engine}`, cached: false });
        const result = await callProvider(provider, engine, query);
        if (result?.error) {
          sendEvent('model-error', { modelId: id, message: result.message, status: result.status, body: result.body });
          finished++;
          if (finished === selected.length) { sendEvent('done', { ok: true }); res.end(); }
          return;
        }
        
        const out = {
          modelId: id,
          modelDisplay: `${provider}:${engine}`,
          text: result.text || '',
          metrics: { timeMs: result.timeMs ?? 0, length: (result.text || '').length },
          raw: result.raw || null
        };
        
        cache.set(key, { ts: Date.now(), val: out });
        
        const chunkSize = 200;
        for (let i = 0; i < out.text.length; i += chunkSize) {
          sendEvent('model-chunk', { modelId: id, text: out.text.slice(i, i + chunkSize) });
        }
        sendEvent('model-end', { modelId: id, metrics: out.metrics });
      } catch (err) {
        sendEvent('model-error', { modelId: id, message: err?.message || String(err) });
      } finally {
        finished++;
        if (finished === selected.length) { sendEvent('done', { ok: true }); res.end(); }
      }
    });

    selected.forEach((_, i) => providerLimit(tasks[i]).catch(err => {
      sendEvent('model-error', { error: err?.message || String(err) });
    }));

  } catch (err) {
    next(err);
  }
});

export default router;
