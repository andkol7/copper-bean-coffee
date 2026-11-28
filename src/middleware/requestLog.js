import { RequestLog } from '../modules/request-logs/model.js';
import { settings } from '../modules/settings/model.js';

// Writes every API request to the request log (collection requestlogs) once its answer has been
// sent, so logging never slows a request down or makes it fail. What is kept: method, path, the
// route it matched, query, status, time taken, who asked (user and role), IP, browser, and for
// errors the code and message the client got. Bodies are never kept: passwords, codes and tokens
// travel in them.
//
// Only /api/... is logged: not the website's files, not /docs, and not /health, which Render calls
// every few seconds. Switched off with settings.requestLogs.enabled.
export function logRequests(req, res, next) {
  if (!req.path.startsWith('/api/') || !settings.requestLogs.enabled) return next();

  const at = new Date();
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    const error = res.statusCode >= 400 ? res.locals.error : undefined; // set by middleware/error.js
    RequestLog.write({
      at,
      method: req.method,
      path: req.path,
      route: req.route?.path,
      query: Object.keys(req.query ?? {}).length ? req.query : undefined,
      status: res.statusCode,
      ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10, // 0.1 ms precision
      user: req.user?.id,
      role: req.user?.role,
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 300),
      error,
    });
  });

  next();
}
