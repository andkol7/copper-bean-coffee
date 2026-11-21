import { config } from '../config.js';

// Sends emails. Everything else in the app calls mailer.send({ to, subject, text }) and does not
// know how the email actually leaves.
//
// The transport is swappable:
//   development - prints the email to the console, so you see the code in the terminal
//   test        - keeps emails in mailer.outbox, so tests can read them
//   production  - not set up yet: a real service (Resend) comes before deploy. Until then it
//                 refuses to send rather than write login codes into the server log.

const consoleTransport = async ({ to, subject, text }) => {
  console.log(`\n----- email -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-----------------\n`);
};

const outboxTransport = async (email) => {
  mailer.outbox.push(email);
};

const notConfiguredTransport = async () => {
  throw new Error('Email sending is not configured for production');
};

const transports = { development: consoleTransport, test: outboxTransport, production: notConfiguredTransport };

export const mailer = {
  outbox: [],
  transport: transports[config.NODE_ENV],

  async send({ to, subject, text }) {
    await this.transport({ to, subject, text });
  },
};
