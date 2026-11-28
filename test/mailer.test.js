import { expect } from 'chai';
import { config } from '../src/config.js';
import { mailer, transports } from '../src/lib/mailer.js';

// The Resend transport, with a fake fetch: tests never send real emails.
describe('mailer', () => {
  const realFetch = globalThis.fetch;
  const saved = { key: config.RESEND_API_KEY, from: config.MAIL_FROM };
  let calls;

  beforeEach(() => {
    calls = [];
    config.RESEND_API_KEY = 're_test_key';
    config.MAIL_FROM = 'Copper Bean Coffee <login@mail.example.com>';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    config.RESEND_API_KEY = saved.key;
    config.MAIL_FROM = saved.from;
  });

  const fakeFetch = (status, body) => async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };

  it('in tests emails go to the outbox, never out, even with a Resend key', async () => {
    globalThis.fetch = fakeFetch(200, { id: 'x' });
    mailer.outbox.length = 0;
    await mailer.send({ to: 'ann@example.com', subject: 'Hi', text: 'Hello' });
    expect(mailer.outbox).to.deep.equal([{ to: 'ann@example.com', subject: 'Hi', text: 'Hello' }]);
    expect(calls).to.have.length(0);
    mailer.outbox.length = 0;
  });

  it('Resend: one POST to /emails with the key, the sender and the email', async () => {
    globalThis.fetch = fakeFetch(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
    await transports.resend({ to: 'ann@example.com', subject: 'Your code: 123456', text: 'Your code is 123456.' });

    expect(calls).to.have.length(1);
    const [{ url, options }] = calls;
    expect(url).to.equal('https://api.resend.com/emails');
    expect(options.method).to.equal('POST');
    expect(options.headers.authorization).to.equal('Bearer re_test_key');
    expect(JSON.parse(options.body)).to.deep.equal({
      from: 'Copper Bean Coffee <login@mail.example.com>',
      to: ['ann@example.com'],
      subject: 'Your code: 123456',
      text: 'Your code is 123456.',
    });
  });

  it('Resend: a refusal becomes an error with its reason, without the key in it', async () => {
    globalThis.fetch = fakeFetch(403, { statusCode: 403, name: 'validation_error', message: 'The mail.example.com domain is not verified.' });
    const err = await transports.resend({ to: 'ann@example.com', subject: 's', text: 't' }).catch((e) => e);
    expect(err.message).to.equal('Resend refused the email (403): The mail.example.com domain is not verified.');
    expect(err.message).to.not.include('re_test_key');
  });
});
