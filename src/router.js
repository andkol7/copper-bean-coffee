import express from 'express';
import { AUTH_LEVELS, requireAuth } from './middleware/auth.js';
import { limitRequests, rateLimitNames } from './middleware/rateLimit.js';
import { REQUEST_PARTS, validate } from './middleware/validate.js';
import { routes } from './routes.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const ROUTE_FIELDS = ['method', 'path', 'rateLimit', 'auth', 'validate', 'handler'];

// Builds an Express router from the route list. Each request goes through, in this order:
//   rateLimit - too many requests from this IP (429); first, before any work is done
//   auth      - who is calling and may they (401/403), so strangers learn nothing else
//   validate  - is the request well-formed (400)
//   handler   - the controller
// rateLimits: false skips the per-IP limits (tests, which send everything from 127.0.0.1).
export function buildRouter(list = routes, { rateLimits = true } = {}) {
  const router = express.Router();
  const seen = new Set();

  for (const route of list) {
    checkRoute(route, seen);
    const { method, path, rateLimit, auth, validate: schemas, handler } = route;

    const steps = [];
    if (rateLimit && rateLimits) steps.push(limitRequests(rateLimit));
    if (auth) steps.push(requireAuth(auth));
    if (schemas) steps.push(validate(schemas));
    router[method](path, ...steps, handler);
  }

  return router;
}

// Catch mistakes in routes.js at startup instead of on the first request.
function checkRoute(route, seen) {
  const { method, path, rateLimit, auth, validate: schemas, handler } = route;
  const name = `${String(method).toUpperCase()} ${path}`;

  if (!METHODS.includes(method)) throw new Error(`Route ${path}: unknown method "${method}"`);
  if (typeof handler !== 'function') throw new Error(`Route ${name}: handler is missing`);

  const unknownField = Object.keys(route).find((key) => !ROUTE_FIELDS.includes(key));
  if (unknownField) throw new Error(`Route ${name}: unknown field "${unknownField}"`);

  if (auth !== undefined && !Object.hasOwn(AUTH_LEVELS, auth)) {
    throw new Error(`Route ${name}: unknown auth "${auth}", use one of ${Object.keys(AUTH_LEVELS).join(', ')}`);
  }

  if (rateLimit !== undefined && !rateLimitNames().includes(rateLimit)) {
    throw new Error(`Route ${name}: unknown rateLimit "${rateLimit}", use one of ${rateLimitNames().join(', ')}`);
  }

  if (schemas) {
    for (const [part, schema] of Object.entries(schemas)) {
      if (!REQUEST_PARTS.includes(part)) throw new Error(`Route ${name}: cannot validate "${part}"`);
      if (typeof schema?.parse !== 'function') throw new Error(`Route ${name}: validate.${part} is not a zod schema`);
    }
  }

  const key = `${method} ${path}`;
  if (seen.has(key)) throw new Error(`Route ${name} is listed twice`);
  seen.add(key);
}
