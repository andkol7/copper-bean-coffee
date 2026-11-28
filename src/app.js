import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { buildOpenApi } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { logRequests } from './middleware/requestLog.js';
import { buildRouter } from './router.js';

// Builds the Express app without starting it. server.js calls listen();
// tests pass the app straight to Supertest, so no real port is needed.
// Tests can pass their own route list; the real app uses src/routes.js.
// Per-IP rate limits are off in tests by default (all requests come from 127.0.0.1);
// the rate limit tests turn them on with rateLimits: true. The request log is off in tests too
// (many test files have no database), requestlog.test.js turns it on.
export function createApp({ routes, rateLimits = config.NODE_ENV !== 'test', requestLogs = config.NODE_ENV !== 'test' } = {}) {
  const app = express();

  // On Render, requests come through their proxy. Trusting one hop makes req.ip
  // the real client address, which rate limiting depends on.
  app.set('trust proxy', 1);

  // Security headers (no sniffing, no framing, etc.) and no "X-Powered-By: Express".
  // One change to the defaults: no "upgrade-insecure-requests", which would make
  // the browser fetch the /docs page's scripts over https even on http://localhost. On Render the
  // whole site is https anyway, so nothing is lost there.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));

  // Every API request goes to the request log once it is answered (middleware/requestLog.js).
  // First, so even a request with broken JSON is timed and logged.
  if (requestLogs) app.use(logRequests);

  // JSON bodies only, and small ones: an API like this never needs more.
  app.use(express.json({ limit: '100kb' }));

  // The website: plain HTML pages with browser JavaScript that calls this same API (public/).
  // /cart finds cart.html, / finds index.html. Only files that exist are served; everything else
  // goes on to the API routes below.
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { extensions: ['html'] }));

  // All routes come from src/routes.js.
  app.use(buildRouter(routes, { rateLimits }));

  // API docs, built from the same route list (src/docs/openapi.js). They live outside routes.js
  // because they are not part of the API: Swagger UI serves a page plus its own script files.
  const openApi = buildOpenApi(routes);
  app.get('/docs/openapi.json', (req, res) => res.json(openApi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApi, { customSiteTitle: 'Copper Bean Coffee API' }));

  // These two go last. A request no route answered gets a JSON 404, and any thrown
  // error ends up in errorHandler (Express 5 also catches rejected async handlers).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
