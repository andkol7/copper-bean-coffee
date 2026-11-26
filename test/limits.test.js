import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { OtpCodeCollection as OtpCode } from '../src/modules/otp/schema.js';
import { PasswordFailureCollection, SessionCollection as Session } from '../src/modules/sessions/schema.js';
import { SettingCollection as Setting } from '../src/modules/settings/schema.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { mailer } from '../src/lib/mailer.js';
import { buildRouter } from '../src/router.js';
import { settings } from '../src/modules/settings/model.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const EMAIL = 'ann@example.com';
const PASSWORD = 'correct horse';

describe('limits', () => {
  before(async () => {
    await startDb();
    await Promise.all([UserCollection.init(), OtpCode.init(), PasswordFailureCollection.init(), Setting.init()]);
  });
  after(async () => {
    await settings.reset();
    await stopDb();
  });

  beforeEach(async () => {
    await new User({ email: EMAIL, name: 'Ann', password: PASSWORD }).create();
  });
  afterEach(async () => {
    await Promise.all(
      [UserCollection, OtpCode, PasswordFailureCollection, Session].map((collection) => collection.deleteMany({})),
    );
    await settings.reset();
    mailer.outbox.length = 0;
  });

  describe('per IP (express-rate-limit)', () => {
    // A fresh app per test: new limiters, counters from zero.
    const appWithLimits = () => createApp({ rateLimits: true });

    it('login: over the limit gives 429 with Retry-After, in the usual error shape', async () => {
      await settings.update({ rateLimits: { login: { max: 3 } } });
      const app = appWithLimits();
      const login = () => request(app).post('/api/v1/auth/sessions').send({ email: EMAIL, password: PASSWORD });

      for (let i = 0; i < 3; i++) expect((await login()).status).to.equal(201);
      const res = await login();
      expect(res.status).to.equal(429);
      expect(res.body.error).to.deep.equal({ code: 'too_many_requests', message: settings.message('tooManyRequests') });
      expect(Number(res.headers['retry-after'])).to.be.above(0);
      expect(res.headers).to.have.property('ratelimit');
    });

    it('each limit counts on its own: hitting login does not block asking for a code', async () => {
      await settings.update({ rateLimits: { login: { max: 1 } } });
      const app = appWithLimits();
      await request(app).post('/api/v1/auth/sessions').send({ email: EMAIL, password: PASSWORD });
      expect((await request(app).post('/api/v1/auth/sessions').send({ email: EMAIL, password: PASSWORD })).status).to.equal(429);
      expect((await request(app).post('/api/v1/auth/otp').send({ email: EMAIL })).status).to.equal(201);
    });

    it('a new max from settings applies without rebuilding the app', async () => {
      const app = appWithLimits();
      const askCode = (email) => request(app).post('/api/v1/auth/otp').send({ email });
      await settings.update({ rateLimits: { otp: { max: 1 } } });
      expect((await askCode('a@example.com')).status).to.equal(201);
      expect((await askCode('b@example.com')).status).to.equal(429);
    });

    it('routes.js with an unknown rateLimit name does not start', () => {
      const route = { method: 'post', path: '/x', rateLimit: 'everything', handler: async () => {} };
      expect(() => buildRouter([route])).to.throw('unknown rateLimit "everything"');
    });
  });

  describe('wrong passwords per email', () => {
    const app = createApp(); // per-IP limits off: this part is about the per-email lock only
    const login = (body) => request(app).post('/api/v1/auth/sessions').send(body);
    const failTimes = async (n, email = EMAIL) => {
      for (let i = 0; i < n; i++) await login({ email, password: 'wrong' });
    };

    it('after maxFailures wrong passwords, even the right one is refused for a while', async () => {
      await failTimes(settings.passwordLock.maxFailures);
      const res = await login({ email: EMAIL, password: PASSWORD });
      expect(res.status).to.equal(429);
      expect(res.body.error.message).to.equal(settings.message('passwordLocked', { minutes: 15 }));
    });

    it('below the limit the right password still works and clears the count', async () => {
      await failTimes(settings.passwordLock.maxFailures - 1);
      expect((await login({ email: EMAIL, password: PASSWORD })).status).to.equal(201);
      expect(await PasswordFailureCollection.countDocuments()).to.equal(0);
    });

    it('while locked, the real user can still log in with an email code, which lifts the lock', async () => {
      await failTimes(settings.passwordLock.maxFailures);
      await request(app).post('/api/v1/auth/otp').send({ email: EMAIL });
      const code = mailer.outbox[0].text.match(/\b(\d{6})\b/)[1];

      expect((await login({ email: EMAIL, code })).status).to.equal(201);
      expect((await login({ email: EMAIL, password: PASSWORD })).status).to.equal(201);
    });

    it('the lock ends by itself after lockMinutes', async () => {
      await failTimes(settings.passwordLock.maxFailures);
      await PasswordFailureCollection.updateOne({ email: EMAIL }, { expiresAt: new Date(Date.now() - 1000) });
      expect((await login({ email: EMAIL, password: PASSWORD })).status).to.equal(201);
    });

    it('an unknown email gets locked the same way, so a lock reveals nothing', async () => {
      const max = settings.passwordLock.maxFailures;
      await failTimes(max, 'nobody@example.com');
      await failTimes(max);
      const unknown = await login({ email: 'nobody@example.com', password: 'whatever' });
      const known = await login({ email: EMAIL, password: 'whatever' });
      expect(unknown.status).to.equal(429);
      expect(unknown.body).to.deep.equal(known.body);
    });

    it('a burst of parallel guesses cannot get past the lock', async () => {
      const max = settings.passwordLock.maxFailures;
      const results = await Promise.all(Array.from({ length: 20 }, () => login({ email: EMAIL, password: 'wrong' })));
      // Each guess is either counted (401) or refused because the lock is already on (429).
      expect(results.every((r) => [401, 429].includes(r.status))).to.equal(true);
      expect((await PasswordFailureCollection.findOne({ email: EMAIL })).failures).to.be.at.least(max);
      expect((await login({ email: EMAIL, password: PASSWORD })).status).to.equal(429);
    });

    it('limits come from settings', async () => {
      await settings.update({ passwordLock: { maxFailures: 2 } });
      await failTimes(2);
      expect((await login({ email: EMAIL, password: PASSWORD })).status).to.equal(429);
    });
  });
});
