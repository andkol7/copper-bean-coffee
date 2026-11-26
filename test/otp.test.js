import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { OtpCodeCollection as OtpCode } from '../src/modules/otp/schema.js';
import { UserCollection } from '../src/modules/users/schema.js';
import { mailer } from '../src/lib/mailer.js';
import { Otp } from '../src/modules/otp/model.js';
import { User } from '../src/modules/users/model.js';
import { settings } from '../src/modules/settings/model.js';
import { startDb, stopDb } from './helpers/db.js';

const app = createApp();
const EMAIL = 'ann@example.com';
const askForCode = (email = EMAIL) => request(app).post('/api/v1/auth/otp').send({ email });
const codeFromMail = (mail) => mail.text.match(/\b(\d{6})\b/)[1];
const lastCode = () => codeFromMail(mailer.outbox.at(-1));

describe('otp', () => {
  const realTransport = mailer.transport;

  before(async () => {
    await startDb();
    await Promise.all([UserCollection.init(), OtpCode.init()]);
  });
  after(stopDb);

  beforeEach(async () => {
    await new User({ email: EMAIL, name: 'Ann', password: 'correct horse' }).create();
  });
  afterEach(async () => {
    await Promise.all([UserCollection.deleteMany({}), OtpCode.deleteMany({})]);
    mailer.outbox.length = 0;
    mailer.transport = realTransport;
  });

  describe('POST /api/v1/auth/otp', () => {
    it('emails a 6-digit code and stores only its hash', async () => {
      const res = await askForCode(' Ann@Example.com');
      expect(res.status).to.equal(201);
      expect(res.body).to.deep.equal({ message: settings.message('otpCodeSent') });

      expect(mailer.outbox).to.have.length(1);
      expect(mailer.outbox[0].to).to.equal(EMAIL);
      const code = lastCode();

      const record = await OtpCode.findOne({ email: EMAIL }).lean();
      expect(record.codeHash).to.match(/^\$2[aby]\$/);
      expect(record.codeHash).to.not.include(code);
    });

    it('answers the same for an unknown email, but sends nothing there', async () => {
      const known = await askForCode();
      const unknown = await askForCode('nobody@example.com');
      expect(unknown.status).to.equal(known.status);
      expect(unknown.body).to.deep.equal(known.body);
      expect(mailer.outbox.map((m) => m.to)).to.deep.equal([EMAIL]);
    });

    it('the resend cooldown is the same for an unknown email, so it does not reveal accounts', async () => {
      await askForCode();
      await askForCode('nobody@example.com');
      const known = await askForCode();
      const unknown = await askForCode('nobody@example.com');
      expect(known.status).to.equal(429);
      expect(unknown.status).to.equal(429);
      expect(unknown.body).to.deep.equal(known.body);
    });

    it('a code issued for an unknown email cannot log anyone in', async () => {
      await new Otp({ email: 'nobody@example.com' }).create();
      // Nobody got the code, and even a lucky guess finds no user to log in.
      for (const code of ['000000', '123456', '999999']) {
        const res = await request(app).post('/api/v1/auth/sessions').send({ email: 'nobody@example.com', code });
        expect(res.status).to.equal(401);
      }
    });

    it('rejects a malformed email with 400', async () => {
      const res = await askForCode('not-an-email');
      expect(res.status).to.equal(400);
      expect(res.body.error.details[0].path).to.equal('email');
    });

    it('does not send a new code within 60 seconds of the previous one', async () => {
      await askForCode();
      const res = await askForCode();
      expect(res.status).to.equal(429);
      expect(mailer.outbox).to.have.length(1);
    });

    it('after the cooldown a new code replaces the old one', async () => {
      await askForCode();
      const oldCode = lastCode();
      // Pretend the first code is 61 s old. Mongoose keeps createdAt read-only, so go to the raw collection.
      await OtpCode.collection.updateOne({ email: EMAIL }, { $set: { createdAt: new Date(Date.now() - 61_000) } });

      expect((await askForCode()).status).to.equal(201);
      const newCode = lastCode();
      expect(await OtpCode.countDocuments({ email: EMAIL })).to.equal(1);
      if (oldCode !== newCode) expect(await Otp.verify(EMAIL, oldCode)).to.equal(false);
      expect(await Otp.verify(EMAIL, newCode)).to.equal(true);
    });

    it('if the email cannot be sent, the code is removed and the request fails', async () => {
      mailer.transport = async () => {
        throw new Error('mail service down');
      };
      const res = await askForCode();
      expect(res.status).to.equal(500);
      expect(await OtpCode.countDocuments()).to.equal(0);
    });
  });

  describe('Otp.verify', () => {
    let code;
    let wrong;
    beforeEach(async () => {
      await new Otp({ email: EMAIL }).create();
      code = lastCode();
      wrong = code === '000000' ? '111111' : '000000';
    });

    it('accepts the right code once, then it is used up', async () => {
      expect(await Otp.verify(' ANN@example.com', code)).to.equal(true);
      expect(await Otp.verify(EMAIL, code)).to.equal(false);
      expect(await OtpCode.countDocuments()).to.equal(0);
    });

    it('rejects a wrong code and counts the attempt', async () => {
      expect(await Otp.verify(EMAIL, wrong)).to.equal(false);
      expect((await OtpCode.findOne({ email: EMAIL })).attempts).to.equal(1);
    });

    it('after maxAttempts wrong guesses even the right code no longer works', async () => {
      for (let i = 0; i < settings.otp.maxAttempts; i++) await Otp.verify(EMAIL, wrong);
      expect(await Otp.verify(EMAIL, code)).to.equal(false);
    });

    it('parallel guesses cannot get past the attempt limit', async () => {
      await Promise.all(Array.from({ length: 20 }, () => Otp.verify(EMAIL, wrong)));
      expect((await OtpCode.findOne({ email: EMAIL })).attempts).to.equal(settings.otp.maxAttempts);
    });

    it('two parallel logins with the right code: only one succeeds', async () => {
      const results = await Promise.all([Otp.verify(EMAIL, code), Otp.verify(EMAIL, code)]);
      expect(results.filter(Boolean)).to.have.length(1);
    });

    it('rejects an expired code', async () => {
      await OtpCode.updateOne({ email: EMAIL }, { expiresAt: new Date(Date.now() - 1000) });
      expect(await Otp.verify(EMAIL, code)).to.equal(false);
    });
  });
});
