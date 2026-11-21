import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { config } from '../src/config.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { email, newPassword } from '../src/lib/validation.js';
import { User } from '../src/modules/users/model.js';

// `npm run seed`: puts the starting data into the database in config.MONGODB_URI.
// Safe to run again: an account that already exists is left exactly as it is, so a re-run
// never resets a password or creates a duplicate.

// A public demo customer for visitors of the live demo. Its password is public on purpose and
// the account has no extra rights. It logs in with the password: on the demo server the email
// code cannot be delivered to a made-up address.
export const DEMO_CUSTOMER = {
  email: 'demo@copperbean.test',
  name: 'Demo Customer',
  password: 'demo-password-123',
};

async function ensureUser(data) {
  if (await User.findByEmail(data.email)) return 'already exists';
  await new User(data).create();
  return 'created';
}

// Returns what was done, e.g. { admin: 'created', demoCustomer: 'already exists' }.
// The admin comes from .env (SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD): the first admin cannot
// register through the API, and nobody else may create one.
export async function seedUsers({ adminEmail, adminPassword }) {
  if (!adminEmail || !adminPassword) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env to create the admin.');
  }
  const admin = z.object({ email, password: newPassword }).parse({ email: adminEmail, password: adminPassword });

  return {
    admin: await ensureUser({ ...admin, name: 'Admin', role: 'admin' }),
    demoCustomer: await ensureUser(DEMO_CUSTOMER),
  };
}

async function main() {
  const db = await connectDb(config.MONGODB_URI);
  console.log(`Seeding database "${db.name}"`);
  try {
    const result = await seedUsers({ adminEmail: config.SEED_ADMIN_EMAIL, adminPassword: config.SEED_ADMIN_PASSWORD });
    console.log(`  admin (${config.SEED_ADMIN_EMAIL}): ${result.admin}`);
    console.log(`  demo customer (${DEMO_CUSTOMER.email}): ${result.demoCustomer}`);
  } finally {
    await disconnectDb();
  }
}

// Runs only when started as `node scripts/seed.js`, not when a test imports seedUsers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.name === 'ZodError' ? z.prettifyError(err) : err.message);
    process.exit(1);
  });
}
