import { Setting as SettingCollection } from '../../db.js';
import { BaseModel } from '../../lib/BaseModel.js';

// Shop settings: limits, email texts and messages. One object for the whole app.
//
// Not the same as src/config.js: config is about the environment (database URL, secrets) and
// comes from .env; settings are about how the shop behaves and are stored in the database,
// so an admin can change them from the CRM without a deploy.
//
// Defaults live here. The database keeps only what an admin changed, and load() lays that
// over the defaults. Texts are templates: {name}, {code} etc. are filled in by render().
//
//   import { settings } from '../settings/model.js';
//   settings.otp.maxAttempts
//   settings.email('otpCode', { name, code, ttlMinutes })   // → { subject, text }

const DEFAULTS = {
  otp: {
    ttlMinutes: 10,
    maxAttempts: 5,
    resendCooldownSeconds: 60,
  },
  // Requests per IP address, for routes with a `rateLimit` field in routes.js.
  // `max` applies at once after a change; `windowMinutes` on the next restart.
  rateLimits: {
    login: { windowMinutes: 15, max: 10 },
    otp: { windowMinutes: 60, max: 5 },
    register: { windowMinutes: 60, max: 10 },
  },
  // Wrong passwords per email. After maxFailures, logging in with a password is closed for
  // that email for lockMinutes after the last failure; logging in with an email code still works,
  // so an attacker cannot lock the real user out.
  passwordLock: {
    maxFailures: 5,
    lockMinutes: 15,
  },
  emails: {
    otpCode: {
      subject: 'Your Copper Bean login code: {code}',
      text:
        'Hi {name},\n\nYour login code is {code}. It works once and expires in {ttlMinutes} minutes.\n\n' +
        'If you did not ask for it, just ignore this email.',
    },
  },
  messages: {
    // The same answer whether the email is registered or not, so it cannot be used
    // to find out who has an account.
    otpCodeSent: 'If this email is registered, a login code has been sent to it.',
    otpCooldown: 'Wait {seconds} s before asking for a new code',
    // One message for a wrong email, password or code: never say which part was wrong.
    loginFailed: 'Wrong email, password or code',
    sessionExpired: 'Your session has expired, please log in again',
    tooManyRequests: 'Too many requests, please try again later',
    passwordLocked: 'Too many wrong passwords. Log in with a code from your email, or try again in {minutes} min',
    authRequired: 'Please log in first',
    forbidden: 'You do not have access to this',
    slugNeeded: 'The slug could not be made from the name, please send one (letters, digits, hyphens)',
    ownRole: 'You cannot change your own role',
    ownAccount: 'You cannot delete your own account here',
    wrongCurrentPassword: 'The current password is wrong',
  },
};

// The one settings document in the database.
class SettingRecord extends BaseModel {
  static schema = SettingCollection;
}
const KEY = 'main';

class Settings {
  static #instance;

  // Always the same object: every module that imports settings sees the same values.
  static getInstance() {
    this.#instance ??= new Settings();
    return this.#instance;
  }

  #overrides = {};

  constructor() {
    this.#apply();
  }

  // Reads the admin's changes from the database. server.js calls it once at startup;
  // until then (and in tests that do not call it) the defaults are used.
  async load() {
    const record = await SettingRecord.findOne({ key: KEY }, { required: false });
    this.#overrides = record?.values ?? {};
    this.#apply();
    return this;
  }

  // Saves changes (for the CRM settings page) and applies them right away.
  // Nested: update({ otp: { maxAttempts: 3 } }) leaves ttlMinutes as it was.
  async update(changes) {
    this.#overrides = merge(this.#overrides, changes);
    await SettingRecord.updateOne({ key: KEY }, { $set: { values: this.#overrides } }, { upsert: true });
    this.#apply();
    return this;
  }

  // Back to the defaults (also handy in tests).
  async reset() {
    this.#overrides = {};
    await SettingRecord.updateOne({ key: KEY }, { $set: { values: {} } }, { upsert: true });
    this.#apply();
    return this;
  }

  // Fills {placeholders} in an email template: settings.email('otpCode', { name, code }).
  email(name, vars) {
    const template = this.emails[name];
    if (!template) throw new Error(`No email template "${name}" in settings`);
    return { subject: render(template.subject, vars), text: render(template.text, vars) };
  }

  // Same for a short message: settings.message('otpCooldown', { seconds: 42 }).
  message(name, vars = {}) {
    const template = this.messages[name];
    if (template === undefined) throw new Error(`No message "${name}" in settings`);
    return render(template, vars);
  }

  // Current values = defaults with the admin's changes on top, as plain properties.
  // Only sections that exist in DEFAULTS are applied, so a stray key in the database
  // (say, "load") can never replace a method of this object.
  #apply() {
    const values = merge(DEFAULTS, this.#overrides);
    for (const section of Object.keys(DEFAULTS)) this[section] = values[section];
  }
}

// Deep merge of plain objects: `extra` wins, nested objects are merged, not replaced.
function merge(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) {
    const both = isPlainObject(value) && isPlainObject(base?.[key]);
    result[key] = both ? merge(base[key], value) : value;
  }
  return result;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// 'Hi {name}' + { name: 'Ann' } → 'Hi Ann'. Unknown placeholders stay as they are, so a typo
// in an admin-edited template is visible instead of silently becoming empty.
function render(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

export const settings = Settings.getInstance();
