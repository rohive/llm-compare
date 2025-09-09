import { callOpenAI, callAnthropic } from './providerClients.js';

export default async function handler(req, res) {
  // Simple model listing: try calling provider if API key present, otherwise return curated defaults
  const openai = [];
  const anthropics = [];

  // If OPENAI_API_KEY exists, attempt a minimal /v1/models fetch
  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
      if (r.ok) {
        const j = await r.json();
        (j.data || []).forEach(m => openai.push({ id: `openai:${m.id}`, provider: 'openai', engine: m.id, displayName: m.id }));
      }
    } catch (e) {
      console.warn('openai list failed', e?.message || e);
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
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
    } catch (e) {
      console.warn('anthropic list failed', e?.message || e);
    }
  }

  // Fallback defaults if empty
  if (openai.length === 0) {
    openai.push({ id: 'openai:gpt-4o', provider: 'openai', engine: 'gpt-4o', displayName: 'gpt-4o', latest: true });
    openai.push({ id: 'openai:gpt-4-0613', provider: 'openai', engine: 'gpt-4-0613', displayName: 'gpt-4-0613' });
  }
  if (anthropics.length === 0) {
    anthropics.push({ id: 'anthropic:claude-3-opus-20240229', provider: 'anthropic', engine: 'claude-3-opus-20240229', displayName: 'claude-3-opus', latest: true });
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ openai, anthropics }));
}
