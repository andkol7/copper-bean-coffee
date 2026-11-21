import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { Session as SessionCollection } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { unauthorized } from '../../lib/errors.js';
import { Otp } from '../otp/model.js';
import { settings } from '../settings/model.js';
import { User } from '../users/model.js';

// The refresh token is looked up by this hash, so it has to be deterministic: sha256, not bcrypt.
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

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
    this.#user = await User.checkCredentials(email, password);
  }

  async #checkCode(email, code) {
    if (await Otp.verify(email, code)) this.#user = await User.findByEmail(email);
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
