import express from 'express';
import fs from 'fs';
import path from 'path';
const router = express.Router();
const dataDir = path.join(process.cwd(), 'server', 'data');
const likesFile = path.join(dataDir, 'likes.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(likesFile)) fs.writeFileSync(likesFile, JSON.stringify([]));
function readLikes() {
  try { return JSON.parse(fs.readFileSync(likesFile, 'utf8')); } catch { return []; }
}
function writeLikes(arr) { fs.writeFileSync(likesFile, JSON.stringify(arr, null, 2)); }
router.post('/', (req, res) => {
  const { query, modelId } = req.body;
  if (!query || !modelId) return res.status(400).json({ error: 'invalid_input' });
  const likes = readLikes();
  likes.push({ id: Date.now().toString(), query, modelId, createdAt: new Date().toISOString() });
  writeLikes(likes);
  res.json({ ok: true });
});
router.get('/', (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'missing_query' });
  const likes = readLikes().filter(l => l.query === query);
  const agg = likes.reduce((acc, cur) => { acc[cur.modelId] = (acc[cur.modelId] || 0) + 1; return acc; }, {});
  const rows = Object.entries(agg).map(([modelId, cnt]) => ({ modelId, count: cnt })).sort((a, b) => b.count - a.count);
  res.json({ likes: rows });
});
export default router;
