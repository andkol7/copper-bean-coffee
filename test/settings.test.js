import { expect } from 'chai';
import { SettingCollection as Setting } from '../src/modules/settings/schema.js';
import { settings } from '../src/modules/settings/model.js';
import { startDb, stopDb } from './helpers/db.js';

describe('settings', () => {
  before(async () => {
    await startDb();
    await Setting.init();
  });
  after(async () => {
    await settings.reset();
    await stopDb();
  });
  afterEach(() => settings.reset());

  it('is one shared object with defaults before anything is loaded', async () => {
    const again = (await import('../src/modules/settings/model.js')).settings;
    expect(again).to.equal(settings);
    expect(settings.otp).to.deep.equal({ ttlMinutes: 10, maxAttempts: 5, resendCooldownSeconds: 60 });
  });

  it('fills placeholders in email templates and messages', () => {
    const { subject, text } = settings.email('otpCode', { name: 'Ann', code: '123456', ttlMinutes: 10 });
    expect(subject).to.equal('Your Copper Bean login code: 123456');
    expect(text).to.include('Hi Ann,').and.include('expires in 10 minutes');
    expect(settings.message('otpCooldown', { seconds: 42 })).to.equal('Wait 42 s before asking for a new code');
  });

  it('leaves an unknown placeholder visible instead of making it empty', async () => {
    await settings.update({ messages: { otpCooldown: 'Wait {secnds} s' } });
    expect(settings.message('otpCooldown', { seconds: 5 })).to.equal('Wait {secnds} s');
  });

  it('update changes only the given values and saves them to the database', async () => {
    await settings.update({ otp: { maxAttempts: 3 } });
    expect(settings.otp).to.deep.equal({ ttlMinutes: 10, maxAttempts: 3, resendCooldownSeconds: 60 });

    const saved = await Setting.findOne({ key: 'main' }).lean();
    expect(saved.values).to.deep.equal({ otp: { maxAttempts: 3 } }); // only the change, not all defaults
  });

  it('load lays the database values over the defaults', async () => {
    await Setting.updateOne({ key: 'main' }, { values: { emails: { otpCode: { subject: 'Code: {code}' } } } }, { upsert: true });
    await settings.load();
    expect(settings.email('otpCode', { code: '000111' }).subject).to.equal('Code: 000111');
    expect(settings.emails.otpCode.text).to.include('Your login code is {code}'); // default kept
  });

  it('a stray key in the database cannot replace a method', async () => {
    await Setting.updateOne({ key: 'main' }, { values: { load: 'oops', message: 'oops' } }, { upsert: true });
    await settings.load();
    expect(settings.load).to.be.a('function');
    expect(settings.message('otpCodeSent')).to.be.a('string');
  });

  it('reset goes back to the defaults', async () => {
    await settings.update({ otp: { ttlMinutes: 1 } });
    await settings.reset();
    expect(settings.otp.ttlMinutes).to.equal(10);
  });
});
