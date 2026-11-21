import { ROLES } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { Session } from '../modules/sessions/model.js';
import { settings } from '../modules/settings/model.js';
import { User } from '../modules/users/model.js';

// Who may call a route, by the `auth` field of its entry in routes.js:
//   auth: 'user'  - anyone logged in
//   auth: 'staff' - managers and admins
//   auth: 'admin' - admins only
// No `auth` field means a public route.
export const AUTH_LEVELS = {
  user: ROLES,
  staff: ['manager', 'admin'],
  admin: ['admin'],
};

// Checks "Authorization: Bearer <access token>" and the user's role, then puts the user
// (a User instance) into req.user.
//   401 - no token, a bad or expired token, or the user no longer exists
//   403 - logged in, but the role is not allowed here
export const requireAuth = (level) => {
  const allowed = AUTH_LEVELS[level];

  return async (req, res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized(settings.message('authRequired'));

    // Signature and expiry; the token carries only the user id.
    const userId = Session.verifyAccessToken(token);

    // The role is not in the token, so it is read here on every request. A role change or a
    // deleted account takes effect at once, not when the 15-minute token runs out.
    const user = await User.findById(userId, { required: false });
    if (!user) throw unauthorized(settings.message('sessionExpired'));
    if (!allowed.includes(user.role)) throw forbidden(settings.message('forbidden'));

    req.user = user;
    next();
  };
};
