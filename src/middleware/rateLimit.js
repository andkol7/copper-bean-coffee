import rateLimit from 'express-rate-limit';
import { tooManyRequests } from '../lib/errors.js';
import { settings } from '../modules/settings/model.js';

// Per-IP request limits for routes with a `rateLimit` field in routes.js, e.g. rateLimit: 'login'.
// The names and numbers are in settings.rateLimits.
//
// Counters live in this process's memory: right for one server (one Render instance). With
// several servers they would move to Redis (rate-limit-redis) so all servers share them.
// The client IP is real only because app.js sets 'trust proxy'; otherwise on Render every
// request would come from the proxy and one limit would hit everybody.
export const rateLimitNames = () => Object.keys(settings.rateLimits);

export function limitRequests(name) {
  return rateLimit({
    windowMs: settings.rateLimits[name].windowMinutes * 60_000,
    // A function, so a new `max` from the CRM applies without a restart.
    limit: () => settings.rateLimits[name].max,
    // Sends RateLimit-* headers and Retry-After, so a client knows when to try again.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Over the limit: hand a 429 to our error handler, so the body has the usual error shape.
    handler: (req, res, next) => next(tooManyRequests(settings.message('tooManyRequests'))),
  });
}
