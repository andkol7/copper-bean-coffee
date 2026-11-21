import { createHash } from 'node:crypto';
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { OtpCode, Session as SessionCollection, User as UserCollection } from '../src/db.js';
import { mailer } from '../src/lib/mailer.js';
import { Session } from '../src/modules/sessions/model.js';
import { settings } from '../src/modules/settings/model.js';
import { User } from '../src/modules/users/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const EMAIL = 'ann@example.com';
const PASSWORD = 'correct horse';
const login = (body) => request(app).post('/api/v1/auth/sessions').send(body);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

describe('sessions', () => {
  let ann;

  before(async () => {
    await startDb();
    await Promise.all([UserCollection.init(), OtpCode.init(), SessionCollection.init()]);
  });
  after(stopDb);

  beforeEach(async () => {
    ann = await new User({ email: EMAIL, name: 'Ann', password: PASSWORD }).create();
  });
  afterEach(async () => {
    await Promise.all([UserCollection.deleteMany({}), OtpCode.deleteMany({}), SessionCollection.deleteMany({})]);
    mailer.outbox.length = 0;
  });

  describe('log in with a password', () => {
    it('gives an access token, a refresh token and the user', async () => {
      const res = await login({ email: 'Ann@Example.com', password: PASSWORD });
      expect(res.status).to.equal(201);
      expect(res.body).to.have.all.keys('accessToken', 'refreshToken', 'user');
      expect(res.body.user).to.include({ id: ann.id, email: EMAIL });
      expect(res.body.user).to.not.have.property('passwordHash');
    });

    it('the access token holds only the user id and its times', async () => {
      const { body } = await login({ email: EMAIL, password: PASSWORD });
      const payload = jwt.decode(body.accessToken);
      expect(payload).to.have.all.keys('sub', 'iat', 'exp');
      expect(payload.sub).to.equal(ann.id);
      expect(payload.exp - payload.iat).to.equal(15 * 60);
      expect(Session.verifyAccessToken(body.accessToken)).to.equal(ann.id);
    });

    it('the database keeps only the sha256 of the refresh token, and no password', async () => {
      const { body } = await login({ email: EMAIL, password: PASSWORD });
      const [saved] = await SessionCollection.find().lean();
      expect(saved.tokenHash).to.equal(sha256(body.refreshToken));
      expect(JSON.stringify(saved)).to.not.include(body.refreshToken).and.not.include(PASSWORD);
      expect(String(saved.user)).to.equal(ann.id);
    });

    it('a wrong password and an unknown email get the same 401', async () => {
      const wrong = await login({ email: EMAIL, password: 'wrong' });
      const unknown = await login({ email: 'nobody@example.com', password: PASSWORD });
      expect(wrong.status).to.equal(401);
      expect(unknown.status).to.equal(401);
      expect(wrong.body).to.deep.equal(unknown.body);
      expect(wrong.body.error.message).to.equal(settings.message('loginFailed'));
    });
  });

  describe('log in with an email code', () => {
    it('works with the code from the email, once', async () => {
      await request(app).post('/api/v1/auth/otp').send({ email: EMAIL });
      const code = mailer.outbox[0].text.match(/\b(\d{6})\b/)[1];

      const res = await login({ email: EMAIL, code });
      expect(res.status).to.equal(201);
      expect(res.body.user.id).to.equal(ann.id);

      expect((await login({ email: EMAIL, code })).status).to.equal(401);
    });
  });

  describe('refresh', () => {
    it('swaps a refresh token for a new pair in the same family', async () => {
      const first = (await login({ email: EMAIL, password: PASSWORD })).body;
      const res = await login({ refreshToken: first.refreshToken });
      expect(res.status).to.equal(201);
      expect(res.body.refreshToken).to.not.equal(first.refreshToken);
      expect(res.body.user.id).to.equal(ann.id);

      const old = await SessionCollection.findOne({ tokenHash: sha256(first.refreshToken) }).lean();
      const fresh = await SessionCollection.findOne({ tokenHash: sha256(res.body.refreshToken) }).lean();
      expect(old.usedAt).to.be.an.instanceOf(Date);
      expect(fresh.family).to.equal(old.family);
    });

    it('a used refresh token coming back ends the whole login', async () => {
      const first = (await login({ email: EMAIL, password: PASSWORD })).body;
      const second = (await login({ refreshToken: first.refreshToken })).body;

      const replay = await login({ refreshToken: first.refreshToken });
      expect(replay.status).to.equal(401);
      // The newer token from the same login is dead too.
      expect((await login({ refreshToken: second.refreshToken })).status).to.equal(401);
      expect(await SessionCollection.countDocuments()).to.equal(0);
    });

    it('another login of the same user is not touched by that', async () => {
      const phone = (await login({ email: EMAIL, password: PASSWORD })).body;
      const laptop = (await login({ email: EMAIL, password: PASSWORD })).body;
      await login({ refreshToken: phone.refreshToken });
      await login({ refreshToken: phone.refreshToken }); // replay on the phone's login
      expect((await login({ refreshToken: laptop.refreshToken })).status).to.equal(201);
    });

    it('two parallel refreshes with the same token: only one gets through', async () => {
      const { refreshToken } = (await login({ email: EMAIL, password: PASSWORD })).body;
      const results = await Promise.all([login({ refreshToken }), login({ refreshToken })]);
      expect(results.map((r) => r.status).sort()).to.deep.equal([201, 401]);
    });

    it('an expired or unknown refresh token gets 401', async () => {
      const { refreshToken } = (await login({ email: EMAIL, password: PASSWORD })).body;
      await SessionCollection.updateOne({}, { expiresAt: new Date(Date.now() - 1000) });
      expect((await login({ refreshToken })).status).to.equal(401);
      expect((await login({ refreshToken: 'x'.repeat(43) })).status).to.equal(401);
    });
  });

  describe('Session.verifyAccessToken', () => {
    it('refuses a token with a changed payload, a wrong secret, or past its time', async () => {
      const { accessToken } = (await login({ email: EMAIL, password: PASSWORD })).body;
      const [header, , signature] = accessToken.split('.');
      const forgedPayload = Buffer.from(JSON.stringify({ sub: 'someone-else', iat: 1, exp: 9999999999 })).toString(
        'base64url',
      );
      const forged = `${header}.${forgedPayload}.${signature}`;
      const otherSecret = jwt.sign({}, 'x'.repeat(40), { subject: ann.id, expiresIn: '15m' });
      const expired = jwt.sign({}, config.JWT_SECRET, { subject: ann.id, expiresIn: -1 });

      for (const token of [forged, otherSecret, expired, 'not-a-jwt']) {
        expect(() => Session.verifyAccessToken(token)).to.throw().with.property('status', 401);
      }
    });

    it('refuses an unsigned token ("alg": "none")', () => {
      const unsigned = jwt.sign({}, null, { subject: ann.id, algorithm: 'none' });
      expect(() => Session.verifyAccessToken(unsigned)).to.throw().with.property('status', 401);
    });
  });

  it('rejects a body that matches none of the three ways with 400', async () => {
    expect((await login({ email: EMAIL })).status).to.equal(400);
    expect((await login({ email: EMAIL, code: '12' })).status).to.equal(400);
  });
});
