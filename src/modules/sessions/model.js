import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { PasswordFailure as PasswordFailureCollection, Session as SessionCollection } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { tooManyRequests, unauthorized } from '../../lib/errors.js';
import { Otp } from '../otp/model.js';
import { settings } from '../settings/model.js';
import { normalizeEmail, User } from '../users/model.js';

// The refresh token is looked up by this hash, so it has to be deterministic: sha256, not bcrypt.
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Wrong passwords per email (settings.passwordLock). Rate limits per IP do not stop an attack
// spread over thousands of addresses; this counts per account instead. Only password login is
// locked: the email code still works, so nobody can lock the real user out by typing wrong
// passwords on purpose. Unknown emails are counted and locked the same way, so a lock does not
// reveal whether an account exists.
export class PasswordFailure extends BaseModel {
  static schema = PasswordFailureCollection;

  // Minutes until password login opens again for this email, or 0 if it is open.
  static async lockedMinutes(email) {
    const { maxFailures } = settings.passwordLock;
    const record = await this.findOne(
      { email: normalizeEmail(email), failures: { $gte: maxFailures }, expiresAt: { $gt: new Date() } },
      { required: false },
    );
    return record ? Math.ceil((record.expiresAt - Date.now()) / 60_000) : 0;
  }

  // One more wrong password. Atomic, so parallel guesses are all counted. Each failure moves the
  // end of the lock to lockMinutes from now.
  static async record(email) {
    const expiresAt = new Date(Date.now() + settings.passwordLock.lockMinutes * 60_000);
    await this.updateOne(
      { email: normalizeEmail(email) },
      { $inc: { failures: 1 }, $set: { expiresAt } },
      { upsert: true },
    );
  }

  // A successful login (by password or by code) starts the count afresh.
  static async clear(email) {
    await this.deleteMany({ email: normalizeEmail(email) });
  }
}

// A login session. Creating one is logging in, by any of three ways:
//   await new Session({ email, password }).create()
//   await new Session({ email, code }).create()          // code from POST /api/v1/auth/otp
//   await new Session({ refreshToken }).create()         // refresh: old pair in, new pair out
// → { accessToken, refreshToken, user }
//
// accessToken: a JWT with only the user id and its times: { sub, iat, exp }. Signed, not
//   encrypted, so anyone can read it; nothing secret goes in. Lives ACCESS_TOKEN_TTL (15 min).
// refreshToken: 256 random bits, given out once; the database keeps its sha256. Lives
//   REFRESH_TOKEN_DAYS and works once: every refresh swaps it for a new one (rotation).
export class Session extends BaseModel {
  static schema = SessionCollection;

  // Tokens and the user exist only in memory; private fields are never saved.
  #accessToken;
  #refreshToken;
  #user;
  #family;

  async create() {
    // Take the login data off the record, so none of it (a password!) is saved with the session.
    const { email, password, code, refreshToken } = this;
    for (const field of ['email', 'password', 'code', 'refreshToken']) delete this[field];

    if (refreshToken) await this.#useRefreshToken(refreshToken);
    else if (code) await this.#checkCode(email, code);
    else if (password) await this.#checkPassword(email, password);
    if (!this.#user) throw unauthorized(settings.message('loginFailed'));

    this.#refreshToken = randomBytes(32).toString('base64url');
    this.user = this.#user.id;
    this.tokenHash = sha256(this.#refreshToken);
    this.family = this.#family ?? randomUUID(); // a new login starts a new family
    this.expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_DAYS * 24 * 60 * 60_000);
    await super.create();

    this.#accessToken = jwt.sign({}, config.JWT_SECRET, {
      subject: this.#user.id,
      expiresIn: config.ACCESS_TOKEN_TTL,
      algorithm: 'HS256',
    });

    return { accessToken: this.#accessToken, refreshToken: this.#refreshToken, user: this.#user };
  }

  async #checkPassword(email, password) {
    // While locked, even the right password is refused; otherwise guessing would just go on.
    const minutes = await PasswordFailure.lockedMinutes(email);
    if (minutes) throw tooManyRequests(settings.message('passwordLocked', { minutes }));

    this.#user = await User.checkCredentials(email, password);
    if (this.#user) await PasswordFailure.clear(email);
    else await PasswordFailure.record(email);
  }

  async #checkCode(email, code) {
    if (await Otp.verify(email, code)) this.#user = await User.findByEmail(email);
    // Logging in with the code also lifts a password lock.
    if (this.#user) await PasswordFailure.clear(email);
  }

  // Rotation: the token is marked used in the same atomic step that finds it, so two requests
  // with the same token cannot both get through.
  async #useRefreshToken(token) {
    const tokenHash = sha256(token);
    const session = await Session.updateOne(
      { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { required: false },
    );

    if (!session) {
      // A token that was already used is coming back: someone has a copy (stolen, or replayed).
      // End that whole login for everyone; the real user simply logs in again.
      const used = await Session.findOne({ tokenHash }, { required: false });
      if (used?.usedAt) await Session.deleteMany({ family: used.family });
      throw unauthorized(settings.message('sessionExpired'));
    }

    this.#family = session.family;
    this.#user = await User.findById(session.user, { required: false });
  }

  // Logging out ends the whole login: every token of this family, used or not.
  async delete() {
    await Session.deleteMany({ family: this.family });
    return true;
  }

  // DELETE /api/v1/auth/sessions { refreshToken }: the session a refresh token belongs to.
  // A used token still finds its session, so logging out works even right after a refresh race.
  static async findByRefreshToken(token) {
    const session = await this.findOne({ tokenHash: sha256(token) }, { required: false });
    if (!session) throw unauthorized(settings.message('sessionExpired'));
    return session;
  }

  // Ends every login of a user: after a password change or when the account is deleted.
  static async endAllFor(userId) {
    await this.deleteMany({ user: userId });
  }

  // For the auth middleware: checks signature and expiry, returns the user id or throws 401.
  // algorithms is pinned, so a token signed some other way (or "alg": "none") is refused.
  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }).sub;
    } catch {
      throw unauthorized(settings.message('sessionExpired'));
    }
  }
}
