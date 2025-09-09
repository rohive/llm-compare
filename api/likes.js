let likes = []; // ephemeral per instance; for persistent storage replace with DB

export default function handler(req, res) {
  if (req.method === 'POST') {
    const { query, modelId } = req.body || {};
    if (!query || !modelId) return res.status(400).json({ error: 'invalid_input' });
    likes.push({ id: Date.now().toString(), query, modelId, createdAt: new Date().toISOString() });
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'GET') {
    const q = req.query?.query;
    if (!q) return res.status(400).json({ error: 'missing_query' });
    const rows = likes.filter(l => l.query === q);
    const agg = rows.reduce((acc, cur) => { acc[cur.modelId] = (acc[cur.modelId] || 0) + 1; return acc; }, {});
    const out = Object.entries(agg).map(([modelId, count]) => ({ modelId, count })).sort((a,b) => b.count - a.count);
    return res.status(200).json({ likes: out });
  }
  res.status(405).json({ error: 'method_not_allowed' });
}
