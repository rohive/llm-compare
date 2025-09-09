import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import modelsRoute from './routes/models.js';
import compareRoute from './routes/compare.js';
import streamRoute from './routes/stream.js';
import likesRoute from './routes/likes.js';

// Robust dotenv loading:
// 1) try repo root .env
// 2) try server/.env
// 3) fallback to environment variables already set
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const serverDotenv = path.join(__dirname, '..', '.env');
const repoDotenv = path.join(repoRoot, '.env');

const tried = [];
if (fs.existsSync(repoDotenv)) {
  dotenv.config({ path: repoDotenv });
  tried.push(repoDotenv);
}
if (fs.existsSync(serverDotenv)) {
  dotenv.config({ path: serverDotenv });
  tried.push(serverDotenv);
}
// also call default (process.cwd()) if nothing was found, so dotenv can still pick up if you run from server folder
if (tried.length === 0) {
  dotenv.config();
  tried.push('.env (process.cwd())');
}

// Start Express app
const app = express();
app.use(express.json({ limit: '1mb' }));

// Small non-sensitive debug: print whether keys are present (do NOT log the key values)
console.log('dotenv: attempted to load:', tried);
console.log('OPENAI_API_KEY present:', !!process.env.OPENAI_API_KEY);
console.log('ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY);

// Register API routes
app.use('/api/models', modelsRoute);
app.use('/api/compare', compareRoute);
app.use('/api/stream', streamRoute);
app.use('/api/likes', likesRoute);

// Serve frontend static build
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'), err => {
      if (err) next(err);
    });
  });
} else {
  console.warn('Warning: frontend build not found at', frontendDist, '- run `npm run build` in frontend before deploying the monolith.');
}

// Healthcheck
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'internal_server_error', message: String(err?.message || err) });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});
