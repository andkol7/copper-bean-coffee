import { BaseController } from '../../lib/BaseController.js';
import { Session } from './model.js';

// POST /api/v1/auth/sessions   → create: log in or refresh (standard)
// DELETE /api/v1/auth/sessions → remove: log out (standard), the only HTTP detail being that the
//   session is found by the refresh token in the body, not by an :id in the URL.
class SessionsController extends BaseController {
  async findRecord(req) {
    return this.Model.findByRefreshToken(req.valid.body.refreshToken);
  }
}

export const sessions = new SessionsController(Session);
