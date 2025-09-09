
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ openai: [], anthropics: [] });

  const openai = [];
  const anthropics = [];

  // Try OpenAI SDK first
  try {
    const mod = await import('openai').catch(() => null);
    const OpenAI = mod?.default ?? mod;
    if (OpenAI && process.env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const list = await client.models.list();
      if (Array.isArray(list?.data)) {
        list.data.forEach(m => openai.push({ id: `openai:${m.id}`, provider: 'openai', engine: m.id, displayName: m.id, raw: m }));
      }
    }
  } catch (err) {
    console.warn('OpenAI SDK list failed:', err?.message || err);
  }

  // Try Anthropic SDK
  try {
    const mod = await import('@anthropic-ai/sdk').catch(() => null);
    const Anthropic = mod?.default ?? mod;
    if (Anthropic && process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      if (client.models && typeof client.models.list === 'function') {
        const list = await client.models.list();
        (list?.data || []).forEach(m => {
          const id = m.id || m.name || String(m);
          anthropics.push({ id: `anthropic:${id}`, provider: 'anthropic', engine: id, displayName: id, raw: m });
        });
      } else if (client.models && Array.isArray(client.models)) {
        client.models.forEach(m => {
          const id = m.id || m.name || String(m);
          anthropics.push({ id: `anthropic:${id}`, provider: 'anthropic', engine: id, displayName: id, raw: m });
        });
      }
    }
  } catch (err) {
    console.warn('Anthropic SDK list failed:', err?.message || err);
  }


  // Fallback REST tries (only if SDKs not present but keys available)
  if (openai.length === 0 && process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
      });
      if (r.ok) {
        const j = await r.json();
        (j.data || []).forEach(m => openai.push({ id: `openai:${m.id}`, provider: 'openai', engine: m.id, displayName: m.id }));
      }
    } catch (e) { console.warn('OpenAI REST list failed', e?.message || e); }
  }

  if (anthropics.length === 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
      });
      if (r.ok) {
        const j = await r.json();
        const items = j.data || j.models || [];
        items.forEach(m => {
          const id = m.id || m.name || String(m);
          anthropics.push({ id: `anthropic:${id}`, provider: 'anthropic', engine: id, displayName: id });
        });
      }
    } catch (e) { console.warn('Anthropic REST list failed', e?.message || e); }
  }

  // Ensure minimal curated defaults so frontend never sees empty lists
  if (openai.length === 0) {
    openai.push({ id: 'openai:gpt-4o', provider: 'openai', engine: 'gpt-4o', displayName: 'gpt-4o', latest: true });
    openai.push({ id: 'openai:gpt-4-0613', provider: 'openai', engine: 'gpt-4-0613', displayName: 'gpt-4-0613' });
    openai.push({ id: 'openai:gpt-3.5-turbo', provider: 'openai', engine: 'gpt-3.5-turbo', displayName: 'gpt-3.5-turbo' });
  }
  if (anthropics.length === 0) {
    anthropics.push({ id: 'anthropic:claude-3-opus-20240229', provider: 'anthropic', engine: 'claude-3-opus-20240229', displayName: 'claude-3-opus', latest: true });
    anthropics.push({ id: 'anthropic:claude-3.1', provider: 'anthropic', engine: 'claude-3.1', displayName: 'claude-3.1' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ openai, anthropics }));
}
