import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { config } from '../src/config.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { email, newPassword } from '../src/lib/validation.js';
import { Product, slugify } from '../src/modules/products/model.js';
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

// The shop window. Prices are in cents. Two products are there on purpose to show the edges:
// Chamomile is out of stock (stock 0), Kenya AA is hidden (active false, staff only).
export const PRODUCTS = [
  { name: 'Ethiopia Yirgacheffe', category: 'coffee', priceCents: 1450, stock: 40, description: 'Washed single origin. Jasmine, bergamot and lemon, with a tea-like body.' },
  { name: 'Colombia Huila', category: 'coffee', priceCents: 1350, stock: 35, description: 'Caramel sweetness, red apple and milk chocolate. A balanced all-rounder.' },
  { name: 'Brazil Santos', category: 'coffee', priceCents: 1200, stock: 60, description: 'Nutty and low in acidity, with a cocoa finish. Very good for espresso.' },
  { name: 'Guatemala Antigua', category: 'coffee', priceCents: 1400, stock: 25, description: 'Dark chocolate, orange peel and a light smoky note.' },
  { name: 'Copper Bean House Blend', category: 'coffee', priceCents: 1100, stock: 80, description: 'Our everyday blend of Brazil and Colombia. Smooth, sweet and easy to brew.' },
  { name: 'Decaf Colombia', category: 'coffee', priceCents: 1300, stock: 15, description: 'Sugarcane decaffeinated. All the sweetness, none of the caffeine.' },
  { name: 'Earl Grey', category: 'tea', priceCents: 900, stock: 50, description: 'Black tea scented with real bergamot oil.' },
  { name: 'Japanese Sencha', category: 'tea', priceCents: 1250, stock: 30, description: 'Fresh green tea, grassy and slightly sweet.' },
  { name: 'Chamomile Flowers', category: 'tea', priceCents: 800, stock: 0, description: 'Caffeine-free whole chamomile flowers. Sold out for now.' },
  { name: 'Ceramic Pour-Over Dripper', category: 'equipment', priceCents: 2800, stock: 20, description: 'A cone dripper for one to two cups. Fits standard paper filters.' },
  { name: 'Hand Burr Grinder', category: 'equipment', priceCents: 5900, stock: 12, description: 'Steel conical burrs and an adjustable grind, from espresso to French press.' },
  { name: 'Gooseneck Kettle', category: 'equipment', priceCents: 4500, stock: 8, description: 'A slim spout for slow, even pouring. 0.9 litres.' },
  { name: 'Kenya AA', category: 'coffee', priceCents: 1600, stock: 0, active: false, description: 'Blackcurrant and grapefruit. Seasonal, not on sale right now.' },
];

// Adds the products that are not in the shop yet, matched by slug; existing ones are not touched,
// so prices edited in the CRM survive a re-run.
export async function seedProducts() {
  let created = 0;
  for (const data of PRODUCTS) {
    if (await Product.findOne({ slug: slugify(data.name) }, { required: false })) continue;
    await new Product(data).create();
    created++;
  }
  return { created, existing: PRODUCTS.length - created };
}

async function main() {
  const db = await connectDb(config.MONGODB_URI);
  console.log(`Seeding database "${db.name}"`);
  try {
    const result = await seedUsers({ adminEmail: config.SEED_ADMIN_EMAIL, adminPassword: config.SEED_ADMIN_PASSWORD });
    console.log(`  admin (${config.SEED_ADMIN_EMAIL}): ${result.admin}`);
    console.log(`  demo customer (${DEMO_CUSTOMER.email}): ${result.demoCustomer}`);
    const products = await seedProducts();
    console.log(`  products: ${products.created} created, ${products.existing} already there`);
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
