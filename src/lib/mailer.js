import { config } from '../config.js';

// Sends emails. Everything else in the app calls mailer.send({ to, subject, text }) and does not
// know how the email actually leaves.
//
// Which way it leaves:
//   tests                       - kept in mailer.outbox, so tests can read them (never sent, even with a key)
//   RESEND_API_KEY set          - sent through Resend (resend.com), in development and in production
//   development without a key   - printed in the terminal, so you see the login code there
//   production without a key    - refused, rather than writing login codes into the server log

// Resend's HTTP API: one POST per email, no SDK needed.
// https://resend.com/docs/api-reference/emails/send-email
const resendTransport = async ({ to, subject, text }) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.MAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000), // a slow mail service must not hang the request forever
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // The message says what is wrong (an unverified domain, a bad key...); the key itself is never in it.
    throw new Error(`Resend refused the email (${res.status}): ${body.message ?? res.statusText}`);
  }
};

const consoleTransport = async ({ to, subject, text }) => {
  console.log(`\n----- email -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-----------------\n`);
};

const outboxTransport = async (email) => {
  mailer.outbox.push(email);
};

const notConfiguredTransport = async () => {
  throw new Error('Email sending is not configured: set RESEND_API_KEY and MAIL_FROM');
};

function pickTransport() {
  if (config.NODE_ENV === 'test') return outboxTransport;
  if (config.RESEND_API_KEY) return resendTransport;
  return config.NODE_ENV === 'production' ? notConfiguredTransport : consoleTransport;
}

export const mailer = {
  outbox: [],
  transport: pickTransport(),

  async send({ to, subject, text }) {
    await this.transport({ to, subject, text });
  },
};

// For tests of the Resend transport itself (with a fake fetch).
export const transports = { resend: resendTransport, console: consoleTransport };
