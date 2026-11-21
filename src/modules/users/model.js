import { User as UserCollection } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';

// Same rule as the schema (lowercase, trim), applied to what we search by.
export const normalizeEmail = (email) => email.trim().toLowerCase();

// A user takes a plain `password` and stores only its hash.
//   const user = await new User({ email, name, password }).create();
export class User extends BaseModel {
  static schema = UserCollection;
  static required = ['email', 'name', 'password'];

  async create() {
    this.passwordHash = await hashPassword(this.password);
    delete this.password;
    return super.create();
  }

  async update({ password, ...changes }) {
    if (password !== undefined) changes.passwordHash = await hashPassword(password);
    return super.update(changes);
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
