import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { fail } from './core/http.js';
import { mountAuth } from './core/auth.js';
import { MODULES } from './modules/index.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));
  mountAuth(app);
  for (const mod of MODULES) mod.mount(app, mod, { modules: MODULES });
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return fail(res, 404, 'ไม่พบ');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  app.use((err, req, res, next) => {
    console.error(err);
    if (!res.headersSent) {
      const status = err.status || err.statusCode || 500;
      fail(res, status, err.message || 'ระบบขัดข้อง');
    }
  });
  return app;
}
