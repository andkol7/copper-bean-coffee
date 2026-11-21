import { otp } from './modules/otp/controller.js';
import { otpRequest } from './modules/otp/schemas.js';
import { sessions } from './modules/sessions/controller.js';
import { sessionCreate } from './modules/sessions/schemas.js';

// Every route of the app in one list. router.js turns each entry into an Express route.
//
// An entry: { method, path, rateLimit?, auth?, validate?, handler }
//   method    - 'get' | 'post' | 'patch' | 'delete'
//   path      - full URL path, e.g. '/api/v1/products/:slug'
//   rateLimit - per-IP request limit by name from settings.rateLimits ('login', 'otp')
//   auth     - who may call it: 'user' (anyone logged in), 'staff' (manager, admin), 'admin';
//              no auth = public. The caller (a User) is then in req.user.
//   validate - optional zod schemas { params?, query?, body? }; the request is checked before
//              the handler runs and the checked data is in req.valid. Required for writes.
//   handler  - async controller function (req, res); small ones like /health live right here
export const routes = [
  {
    method: 'get',
    path: '/health',
    // Used by Render health checks. The database is connected by server.js before
    // the app starts listening, so answering at all means the app is up.
    handler: async (req, res) => {
      res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
    },
  },

  // ---------- Auth ----------
  { method: 'post', path: '/api/v1/auth/otp', rateLimit: 'otp', validate: { body: otpRequest }, handler: otp.create },
  {
    method: 'post',
    path: '/api/v1/auth/sessions',
    rateLimit: 'login',
    validate: { body: sessionCreate },
    handler: sessions.create,
  },
  {
    method: 'get',
    path: '/api/v1/auth/me',
    auth: 'user',
    // The logged-in user, already loaded by the auth step.
    handler: async (req, res) => {
      res.json(req.user);
    },
  },
];
