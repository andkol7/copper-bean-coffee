// Loaded by Mocha before any test file (see .mocharc.json).
// Set before src/config.js is imported, so the app sees the test environment.
process.env.NODE_ENV = 'test';

// Root hooks, run around every test in every file.
export const mochaHooks = {
  // Emails sent in tests land in mailer.outbox (never sent for real). Many actions send one now
  // (placing an order, a status change), so every test starts with an empty outbox and only
  // sees its own emails.
  async beforeEach() {
    const { mailer } = await import('../src/lib/mailer.js');
    mailer.outbox.length = 0;
  },
};
