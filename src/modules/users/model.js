import { randomBytes } from 'node:crypto';
import { STAFF_ROLES, UserCollection } from './schema.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { escapeRegex } from '../../lib/validation.js';
import { Address } from '../addresses/model.js';
import { Order } from '../orders/model.js';
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

  // A manager or an admin. A getter on the class, so it is never saved or sent in JSON.
  get isStaff() {
    return STAFF_ROLES.includes(this.role);
  }

  async create(options) {
    this.passwordHash = await hashPassword(this.password);
    delete this.password;
    return super.create(options);
  }

  // A password change by the user themselves needs the current password (a stolen access token
  // alone must not be enough to take the account), and ends all their sessions everywhere.
  async update({ password, currentPassword, ...changes }, options = {}) {
    if (this.deletedAt) throw notFound(this.constructor.schema.modelName); // nothing left to edit
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

  // Deleting an account (agreed with Andrey 2026-11-26):
  //   - no history (no orders): the user is deleted completely;
  //   - with history: the record stays, so the orders still have their customer, but everything
  //     personal is wiped: name, email, phone, password. The email becomes free for a new account.
  // Either way the saved addresses and all logins go. An order keeps its own copy of the delivery
  // address: it is the record of a sale, not part of the profile.
  // The shop must never lose its last admin to a slip of the mouse, so nobody deletes themselves here.
  async delete(options = {}) {
    if (options.actor?.id === this.id) throw forbidden(settings.message('ownAccount'));
    if (this.deletedAt) return true; // already wiped

    await Session.endAllFor(this.id);
    await Address.deleteMany({ user: this.id });

    if (!(await this.hasHistory())) return super.delete(options);

    // .invalid is a top-level domain reserved for addresses that can never exist (RFC 2606),
    // so no email can ever go there, and the id keeps it unique.
    await this.updateIf(
      {},
      {
        $set: {
          email: `deleted-${this.id}@deleted.invalid`,
          name: settings.message('deletedUserName'),
          // A hash of random bytes nobody knows: no password can ever match it.
          passwordHash: await hashPassword(randomBytes(32).toString('hex')),
          deletedAt: new Date(),
        },
        $unset: { phone: 1 },
      },
    );
    return true;
  }

  // Is there anything that has to keep pointing at this user? Orders today; payments and CRM
  // notes will join here when their modules come.
  async hasHistory() {
    return (await Order.count({ customer: this.id })) > 0;
  }

  // GET /api/v1/users?role=manager&q=ann
  static listFilter({ role, q } = {}) {
    const filter = { deletedAt: null }; // wiped accounts are not people any more
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
