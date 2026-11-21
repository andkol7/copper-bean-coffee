import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { buildRouter } from './router.js';

// Builds the Express app without starting it. server.js calls listen();
// tests pass the app straight to Supertest, so no real port is needed.
// Tests can pass their own route list; the real app uses src/routes.js.
// Per-IP rate limits are off in tests by default (all requests come from 127.0.0.1);
// the rate limit tests turn them on with rateLimits: true.
export function createApp({ routes, rateLimits = config.NODE_ENV !== 'test' } = {}) {
  const app = express();

  // On Render, requests come through their proxy. Trusting one hop makes req.ip
  // the real client address, which rate limiting depends on.
  app.set('trust proxy', 1);

  // Security headers (no sniffing, no framing, etc.) and no "X-Powered-By: Express".
  app.use(helmet());

  // JSON bodies only, and small ones: an API like this never needs more.
  app.use(express.json({ limit: '100kb' }));

  // All routes come from src/routes.js.
  app.use(buildRouter(routes, { rateLimits }));

  // These two go last. A request no route answered gets a JSON 404, and any thrown
  // error ends up in errorHandler (Express 5 also catches rejected async handlers).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
