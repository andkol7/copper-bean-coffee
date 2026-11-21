import { BaseController } from '../../lib/BaseController.js';
import { User } from './model.js';

// /api/v1/users and /api/v1/staff: standard handlers. Registration and staff creation are both
// a plain create; the route's zod schema decides whether `role` may be sent.
export const users = new BaseController(User);

// /api/v1/users/me: the same handlers, but the record is the logged-in user, not an :id.
class MeController extends BaseController {
  async findRecord(req) {
    return req.user;
  }
}

export const me = new MeController(User);
