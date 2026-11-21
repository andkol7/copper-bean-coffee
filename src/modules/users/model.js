import { User as UserCollection } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { escapeRegex } from '../../lib/validation.js';
import { Session } from '../sessions/model.js';
import { settings } from '../settings/model.js';

// Same rule as the schema (lowercase, trim), applied to what we search by.
export const normalizeEmail = (email) => email.trim().toLowerCase();

// A user takes a plain `password` and stores only its hash.
//   const user = await new User({ email, name, password }).create();
// Who may set which fields (role only by an admin, etc.) is decided by the zod schema of each
// route; the rules here are the ones that depend on who acts ({ actor }).
export class User extends BaseModel {
  static schema = UserCollection;
  static required = ['email', 'name', 'password'];

  async create(options) {
    this.passwordHash = await hashPassword(this.password);
    delete this.password;
    return super.create(options);
  }

  // A password change by the user themselves needs the current password (a stolen access token
  // alone must not be enough to take the account), and ends all their sessions everywhere.
  async update({ password, currentPassword, ...changes }, options = {}) {
    const { actor } = options;
    const self = actor?.id === this.id;

    if (self && changes.role !== undefined && changes.role !== this.role) {
      throw forbidden(settings.message('ownRole'));
    }

    if (password !== undefined) {
      if (self && !(await User.checkCredentials(this.email, currentPassword ?? ''))) {
        throw badRequest(settings.message('wrongCurrentPassword'));
      }
      changes.passwordHash = await hashPassword(password);
    }

    await super.update(changes, options);
    if (password !== undefined) await Session.endAllFor(this.id);
    return this;
  }

  // The shop must never lose its last admin to a slip of the mouse.
  async delete(options = {}) {
    if (options.actor?.id === this.id) throw forbidden(settings.message('ownAccount'));
    const deleted = await super.delete(options);
    await Session.endAllFor(this.id);
    return deleted;
  }

  // GET /api/v1/users?role=manager&q=ann
  static listFilter({ role, q } = {}) {
    const filter = {};
    if (role) filter.role = role;
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ email: pattern }, { name: pattern }];
    }
    return filter;
  }

  // null (not 404) when there is no such user: "is this email taken?" is a normal question.
  static async findByEmail(email) {
    return this.findOne({ email: normalizeEmail(email) }, { required: false });
  }

  // For login. Returns the user if email and password match, otherwise null, without saying which
  // part was wrong, and in the same time either way (see verifyPassword).
  static async checkCredentials(email, password) {
    const user = await this.findOne({ email: normalizeEmail(email) }, { required: false, select: '+passwordHash' });
    const ok = await verifyPassword(password, user?.passwordHash);
    return ok ? user : null;
  }
}
