import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: process.env.NODE_ENV === 'test' ? false : undefined });
  app.use(helmet());
  app.use((_req: Request, res: Response, next: NextFunction) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // Deliberately single-process limits. Do not trust arbitrary forwarded IP headers.
  const clients = new Map<string, { count: number; resetAt: number }>();
  let total = 0;
  let totalResetAt = Date.now() + 60000;
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS' || req.path === '/health') return next();
    const now = Date.now();
    if (now >= totalResetAt) { total = 0; totalResetAt = now + 60000; clients.clear(); }
    const key = req.ip || 'unknown';
    const entry = clients.get(key) || { count: 0, resetAt: totalResetAt };
    if (++total > 120 || ++entry.count > 30) {
      res.setHeader('Retry-After', String(Math.ceil((totalResetAt - now) / 1000)));
      return res.status(429).json({ message: 'Too many requests. Please try again in a minute.' });
    }
    clients.set(key, entry);
    next();
  });
  app.use(json({ limit: '256kb' }));
  const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map((value) => value.trim());
  app.enableCors({ origin: origins, methods: ['GET', 'POST', 'OPTIONS'] });
  return app;
}
if (require.main === module) {
  void createApp().then((app) => app.listen(Number(process.env.PORT) || 3001, '0.0.0.0'));
}
