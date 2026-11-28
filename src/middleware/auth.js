import { ROLES, STAFF_ROLES } from '../modules/users/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { Session } from '../modules/sessions/model.js';
import { settings } from '../modules/settings/model.js';
import { User } from '../modules/users/model.js';

// Who may call a route, by the `auth` field of its entry in routes.js:
//   auth: 'optional' - anyone; logged in or not. A token that is sent must still be good
//                      (req.user is set), a request without one goes on as a guest (no req.user).
//                      For public pages that show more to staff, e.g. hidden products.
//   auth: 'user'     - anyone logged in
//   auth: 'staff'    - managers and admins
//   auth: 'admin'    - admins only
// No `auth` field means a public route that never looks at the token.
export const AUTH_LEVELS = {
  optional: ROLES,
  user: ROLES,
  staff: STAFF_ROLES,
  admin: ['admin'],
};

// Checks "Authorization: Bearer <access token>" and the user's role, then puts the user
// (a User instance) into req.user.
//   401 - no token, a bad or expired token, or the user no longer exists
//   403 - logged in, but the role is not allowed here
export const requireAuth = (level) => {
  const allowed = AUTH_LEVELS[level];

  return async (req, res, next) => {
    const header = req.get('authorization');
    if (level === 'optional' && !header) return next(); // a guest

    const [scheme, token] = (header ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized(settings.message('authRequired'));

    // Signature and expiry; the token carries only the user id.
    const userId = Session.verifyAccessToken(token);

    // The role is not in the token, so it is read here on every request. A role change or a
    // deleted account takes effect at once, not when the 15-minute token runs out.
    const user = await User.findById(userId, { required: false });
    if (!user || user.deletedAt) throw unauthorized(settings.message('sessionExpired'));

    // Known before the role check, so the request log records WHO was refused a 403 too.
    // A refused request never reaches its handler, so this gives nothing away.
    req.user = user;
    if (!allowed.includes(user.role)) throw forbidden(settings.message('forbidden'));
    next();
  };
};
