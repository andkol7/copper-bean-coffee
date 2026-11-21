import { randomInt } from 'node:crypto';
import { OtpCode } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';
import { tooManyRequests } from '../../lib/errors.js';
import { mailer } from '../../lib/mailer.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { settings } from '../settings/model.js';
import { normalizeEmail, User } from '../users/model.js';

// A one-time login code. Limits and texts come from settings (settings.otp, emails.otpCode).
//   await new Otp({ email }).create();       // POST /api/v1/auth/otp, via BaseController.create
//   const ok = await Otp.verify(email, code);
export class Otp extends BaseModel {
  static schema = OtpCode;
  static required = ['email'];

  // The plain code and its owner live only in memory, between issue() and send();
  // private fields are not saved to the database.
  #code;
  #user;

  // Creates a code and sends it if the email belongs to a user.
  // A code is issued for every email, registered or not, and only the sending depends on it.
  // That way the answer, the resend cooldown (429) and the time taken (bcrypt) are the same
  // either way, so none of them tells whether an account exists. A code for an unknown email
  // is never sent, and logging in with it fails anyway: there is no such user.
  async create() {
    this.email = normalizeEmail(this.email);
    this.#user = await User.findByEmail(this.email);
    await this.issue();
    if (this.#user) {
      try {
        await this.send();
      } catch (err) {
        // A code nobody received must not stay valid.
        await this.delete({ required: false });
        throw err;
      }
    }
    return { message: settings.message('otpCodeSent') };
  }

  // Saves a new code for this email, replacing the previous one. Only the bcrypt hash is stored.
  async issue() {
    const { ttlMinutes, resendCooldownSeconds } = settings.otp;

    const previous = await Otp.findOne({ email: this.email }, { required: false });
    if (previous) {
      const secondsSince = (Date.now() - previous.createdAt.getTime()) / 1000;
      if (secondsSince < resendCooldownSeconds) {
        throw tooManyRequests(settings.message('otpCooldown', { seconds: Math.ceil(resendCooldownSeconds - secondsSince) }));
      }
      await previous.delete({ required: false });
    }

    // crypto.randomInt, not Math.random: Math.random is predictable and must not make secrets.
    this.#code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codeHash = await hashPassword(this.#code);
    this.expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    // super.create: the plain BaseModel save, not this class's create above.
    await super.create();
  }

  // Delivers the code. Email for now; Telegram joins in phase 4.
  async send() {
    const { subject, text } = settings.email('otpCode', {
      name: this.#user.name,
      code: this.#code,
      ttlMinutes: settings.otp.ttlMinutes,
    });
    await mailer.send({ to: this.email, subject, text });
  }

  // true only for the right, unexpired, unused code with attempts left. The code is single-use.
  static async verify(email, code) {
    // Take one attempt atomically before comparing: parallel guesses cannot share the same
    // "attempts left" and slip past the limit. An expired or used-up code simply does not match.
    const record = await this.updateOne(
      { email: normalizeEmail(email), attempts: { $lt: settings.otp.maxAttempts }, expiresAt: { $gt: new Date() } },
      { $inc: { attempts: 1 } },
      { required: false },
    );

    // With no record, verifyPassword still spends the time of a real check (see password.js).
    const ok = await verifyPassword(code, record?.codeHash);
    if (!ok) return false;

    // Delete to use it up. If two requests with the right code race, only the one that actually
    // deleted the record wins.
    return record.delete({ required: false });
  }
}
