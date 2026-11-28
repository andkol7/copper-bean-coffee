// npm run smoke: calls every API route, one after another, the way a client would, against a real
// server started for the run. Unlike npm test (in-memory MongoDB), this uses the real database server
// from .env, Atlas or local, but on a THROWAWAY database next to yours (<name>-smoke), which is seeded
// first and dropped at the end. Your data is never touched. Good to run before a deploy.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import { dropThrowaway, throwawayUri } from './lib/throwaway-db.js';

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
const ADMIN = { email: 'smoke-admin@copperbean.test', password: 'smoke admin password 1' };
const DEMO = { email: 'demo@copperbean.test', password: 'demo-password-123' };

const throwaway = throwawayUri(process.env.MONGODB_URI, 'smoke');
const { uri, name: SMOKE_DB } = throwaway;

const env = {
  ...process.env,
  MONGODB_URI: uri,
  NODE_ENV: 'development',
  PORT: String(PORT),
  RUN_JOBS: 'false',
  // Never send real email from a check: the addresses are made up, and the check reads the login
  // codes from the server's terminal. An empty key means "not set" (config.js).
  RESEND_API_KEY: '',
  MAIL_FROM: '',
  SEED_ADMIN_EMAIL: ADMIN.email,
  SEED_ADMIN_PASSWORD: ADMIN.password,
};

let failed = 0;
let passed = 0;
const check = (name, ok, extra = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${extra ? `  (${extra})` : ''}`);
};
const section = (name) => console.log(`\n${name}`);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, headers: res.headers };
}
const expectStatus = async (name, want, method, path, opts) => {
  const res = await call(method, path, opts);
  check(`${method} ${path} → ${want}  ${name}`, res.status === want, res.status === want ? '' : `got ${res.status} ${JSON.stringify(res.body)?.slice(0, 160)}`);
  return res;
};

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });

let server;
let serverLog = '';
const codeFor = (email) => {
  const blocks = serverLog.split('----- email -----').filter((b) => b.includes(`To: ${email}`));
  return blocks.at(-1)?.match(/login code is (\d{6})/)?.[1];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // ---------- Prepare the throwaway database ----------
  console.log(`Throwaway database: ${SMOKE_DB}`);
  await dropThrowaway(throwaway); // start clean, if a previous run was interrupted
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  if (mongoose.connection.name !== SMOKE_DB) throw new Error('Connected to the wrong database; stopping.');
  // A bigger login limit than the default 10, so the run itself fits; the limit is tested at the end.
  await mongoose.connection.db.collection('settings').insertOne({ key: 'main', values: { rateLimits: { login: { max: 40 } } } });
  await mongoose.disconnect();

  console.log((await run(['scripts/seed.js'])).trim());

  server = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 60 && !serverLog.includes('Server listening'); i++) await sleep(500);
  if (!serverLog.includes('Server listening')) throw new Error('The server did not start:\n' + serverLog);

  // ---------- System ----------
  section('System');
  await expectStatus('server is up', 200, 'GET', '/health');
  const spec = await expectStatus('API description', 200, 'GET', '/docs/openapi.json');
  check('the description lists every route', Object.values(spec.body.paths).reduce((n, m) => n + Object.keys(m).length, 0) === 38);
  const nope = await expectStatus('unknown route, JSON error', 404, 'GET', '/api/v1/nothing');
  check('error shape { error: { code, message } }', nope.body?.error?.code === 'not_found');

  // ---------- Registration and login ----------
  section('Registration and login');
  const newbie = { email: 'Smoke.Customer@Example.com', name: 'Smoke Customer', password: 'smoke customer pw' };
  const reg = await expectStatus('register', 201, 'POST', '/api/v1/users', { body: { ...newbie, role: 'admin' } });
  check('a registered user is always a customer, email lowercased', reg.body?.role === 'customer' && reg.body?.email === 'smoke.customer@example.com');
  check('no password hash in the answer', reg.body && !('passwordHash' in reg.body));
  await expectStatus('the same email again', 409, 'POST', '/api/v1/users', { body: newbie });
  await expectStatus('a short password', 400, 'POST', '/api/v1/users', { body: { ...newbie, email: 'x@example.com', password: 'short' } });

  let demo = (await expectStatus('demo customer logs in with a password', 201, 'POST', '/api/v1/auth/sessions', { body: DEMO })).body;
  check('the answer has both tokens and the user', !!(demo?.accessToken && demo?.refreshToken && demo?.user?.id));
  const wrong = await expectStatus('wrong password', 401, 'POST', '/api/v1/auth/sessions', { body: { ...DEMO, password: 'nope' } });
  const unknown = await expectStatus('unknown email', 401, 'POST', '/api/v1/auth/sessions', { body: { email: 'nobody@example.com', password: 'nope' } });
  check('wrong password and unknown email answer the same', JSON.stringify(wrong.body) === JSON.stringify(unknown.body));
  await expectStatus('a body that fits no way of logging in', 400, 'POST', '/api/v1/auth/sessions', { body: { code: '123456' } });

  section('Login by email code');
  await expectStatus('ask for a code', 201, 'POST', '/api/v1/auth/otp', { body: { email: DEMO.email } });
  await expectStatus('ask again within 60 s', 429, 'POST', '/api/v1/auth/otp', { body: { email: DEMO.email } });
  const code = codeFor(DEMO.email);
  check('the code was "emailed" (printed by the dev mailer)', !!code);
  await expectStatus('log in with the code', 201, 'POST', '/api/v1/auth/sessions', { body: { email: DEMO.email, code } });
  await expectStatus('the same code again', 401, 'POST', '/api/v1/auth/sessions', { body: { email: DEMO.email, code } });

  section('Tokens');
  const refreshed = await expectStatus('swap the refresh token for a new pair', 201, 'POST', '/api/v1/auth/sessions', { body: { refreshToken: demo.refreshToken } });
  await expectStatus('the old refresh token again (theft detection)', 401, 'POST', '/api/v1/auth/sessions', { body: { refreshToken: demo.refreshToken } });
  await expectStatus('...which also ended the newer token of that login', 401, 'POST', '/api/v1/auth/sessions', { body: { refreshToken: refreshed.body.refreshToken } });
  demo = (await call('POST', '/api/v1/auth/sessions', { body: DEMO })).body;

  // ---------- Profile ----------
  section('Profile');
  await expectStatus('my profile', 200, 'GET', '/api/v1/users/me', { token: demo.accessToken });
  await expectStatus('my profile without a token', 401, 'GET', '/api/v1/users/me');
  await expectStatus('a broken token', 401, 'GET', '/api/v1/users/me', { token: 'not-a-token' });
  const renamed = await expectStatus('change my name and phone', 200, 'PATCH', '/api/v1/users/me', { token: demo.accessToken, body: { name: 'Demo Buyer', phone: '+380 67 000 00 00', role: 'admin' } });
  check('the role sent along is ignored', renamed.body?.role === 'customer' && renamed.body?.name === 'Demo Buyer');
  await expectStatus('a new password without the current one', 400, 'PATCH', '/api/v1/users/me', { token: demo.accessToken, body: { password: 'brand new password' } });

  // ---------- Catalogue ----------
  section('Products and shipping (public)');
  const products = await expectStatus('products on sale', 200, 'GET', '/api/v1/products?limit=50');
  check('12 on sale (Kenya AA is hidden)', products.body?.total === 12);
  const search = await expectStatus('full-text search', 200, 'GET', '/api/v1/products?q=colombia');
  const found = search.body?.items?.map((p) => p.slug) ?? [];
  check('3 found: the two with Colombia in the name first, House Blend (only in its description) last', found.length === 3 && found.slice(0, 2).sort().join(',') === 'colombia-huila,decaf-colombia' && found[2] === 'copper-bean-house-blend', found.join(', '));
  const cheap = await expectStatus('cheapest tea first', 200, 'GET', '/api/v1/products?category=tea&sort=price_asc');
  check('Chamomile ($8.00) first', cheap.body?.items?.[0]?.slug === 'chamomile-flowers');
  await expectStatus('only in stock', 200, 'GET', '/api/v1/products?inStock=true');
  const bySlug = await expectStatus('one product by slug', 200, 'GET', '/api/v1/products/ethiopia-yirgacheffe');
  await expectStatus('the same product by id', 200, 'GET', `/api/v1/products/${bySlug.body.id}`);
  await expectStatus('a hidden product for a guest', 404, 'GET', '/api/v1/products/kenya-aa');
  await expectStatus('a bad filter', 400, 'GET', '/api/v1/products?sort=random');
  const ua = await expectStatus('shipping to Ukraine', 200, 'GET', '/api/v1/shipping-methods?country=UA');
  check('Standard and Express', ua.body?.items?.map((m) => m.name).join(',') === 'Standard,Express');
  const standard = ua.body.items[0];
  const us = (await call('GET', '/api/v1/shipping-methods?country=US')).body.items[0];

  // ---------- Addresses ----------
  section('Addresses');
  const home = (await expectStatus('save an address', 201, 'POST', '/api/v1/addresses', { token: demo.accessToken, body: { label: 'Home', name: 'Demo Buyer', phone: '+380 67 000 00 00', line1: '1 Khreshchatyk St', city: 'Kyiv', postalCode: '01001', country: 'ua' } })).body;
  check('country tidied to UA', home?.country === 'UA');
  const abroad = (await call('POST', '/api/v1/addresses', { token: demo.accessToken, body: { name: 'Demo Buyer', phone: '+1 512 555 0100', line1: '1 Congress Ave', city: 'Austin', postalCode: '73301', country: 'US' } })).body;
  await expectStatus('my addresses', 200, 'GET', '/api/v1/addresses', { token: demo.accessToken });
  await expectStatus('change an address', 200, 'PATCH', `/api/v1/addresses/${abroad.id}`, { token: demo.accessToken, body: { line2: 'Suite 100' } });
  await expectStatus('a bad country code', 400, 'POST', '/api/v1/addresses', { token: demo.accessToken, body: { name: 'x', phone: '+380 67 000 00 00', line1: 'x', city: 'x', postalCode: '1', country: 'Ukraine' } });

  // ---------- Orders ----------
  section('Orders (customer)');
  const order = (await expectStatus('place an order', 201, 'POST', '/api/v1/orders', { token: demo.accessToken, body: { items: [{ product: bySlug.body.id, quantity: 2 }], addressId: home.id, shippingMethodId: standard.id, unitPriceCents: 1 } })).body;
  check('number CB-1001, price from the database, $4.99 delivery', order?.number === 'CB-1001' && order?.subtotalCents === 2900 && order?.shipping?.priceCents === 499 && order?.totalCents === 3399);
  const afterOrder = (await call('GET', '/api/v1/products/ethiopia-yirgacheffe')).body;
  check('stock went from 40 to 38', afterOrder.stock === 38);
  const grinder = (await call('GET', '/api/v1/products/hand-burr-grinder')).body;
  const free = (await expectStatus('an order over $50', 201, 'POST', '/api/v1/orders', { token: demo.accessToken, body: { items: [{ product: grinder.id, quantity: 1 }], addressId: home.id, shippingMethodId: standard.id } })).body;
  check('free delivery from $50', free?.shipping?.priceCents === 0 && free?.number === 'CB-1002');
  await expectStatus('Standard to the US address', 400, 'POST', '/api/v1/orders', { token: demo.accessToken, body: { items: [{ product: grinder.id, quantity: 1 }], addressId: abroad.id, shippingMethodId: standard.id } });
  await expectStatus('International to the US address', 201, 'POST', '/api/v1/orders', { token: demo.accessToken, body: { items: [{ product: grinder.id, quantity: 1 }], addressId: abroad.id, shippingMethodId: us.id } });
  await expectStatus('more than in stock', 409, 'POST', '/api/v1/orders', { token: demo.accessToken, body: { items: [{ product: grinder.id, quantity: 99 }], addressId: home.id, shippingMethodId: standard.id } });
  const chamomile = (await call('GET', '/api/v1/products/chamomile-flowers')).body;
  await expectStatus('a sold-out product', 409, 'POST', '/api/v1/orders', { token: demo.accessToken, body: { items: [{ product: chamomile.id, quantity: 1 }], addressId: home.id, shippingMethodId: standard.id } });
  await expectStatus('the same product twice', 400, 'POST', '/api/v1/orders', { token: demo.accessToken, body: { items: [{ product: grinder.id, quantity: 1 }, { product: grinder.id, quantity: 1 }], addressId: home.id, shippingMethodId: standard.id } });
  const mine = await expectStatus('my orders', 200, 'GET', '/api/v1/orders', { token: demo.accessToken });
  check('three orders, newest first', mine.body?.total === 3 && mine.body.items[0].number === 'CB-1003');
  await expectStatus('one of my orders', 200, 'GET', `/api/v1/orders/${order.id}`, { token: demo.accessToken });
  await expectStatus('mark my own order paid', 403, 'PATCH', `/api/v1/orders/${order.id}`, { token: demo.accessToken, body: { status: 'paid' } });
  const cancelled = await expectStatus('cancel my unpaid order', 200, 'PATCH', `/api/v1/orders/${free.id}`, { token: demo.accessToken, body: { status: 'cancelled', note: 'Changed my mind' } });
  check('history has the cancel', cancelled.body?.statusHistory?.at(-1)?.status === 'cancelled');
  const grinderNow = (await call('GET', '/api/v1/products/hand-burr-grinder')).body;
  check('the grinder went back on the shelf (12 - 2 + 1 = 11)', grinderNow.stock === 11);

  // ---------- Staff ----------
  section('Staff');
  const admin = (await expectStatus('admin logs in', 201, 'POST', '/api/v1/auth/sessions', { body: ADMIN })).body;
  const mgrBody = { email: 'smoke-manager@copperbean.test', name: 'Smoke Manager', password: 'smoke manager pw', role: 'manager' };
  await expectStatus('a customer cannot create staff', 403, 'POST', '/api/v1/staff', { token: demo.accessToken, body: mgrBody });
  const manager = (await expectStatus('admin creates a manager', 201, 'POST', '/api/v1/staff', { token: admin.accessToken, body: mgrBody })).body;
  const mgr = (await expectStatus('the manager logs in', 201, 'POST', '/api/v1/auth/sessions', { body: { email: mgrBody.email, password: mgrBody.password } })).body;

  await expectStatus('a manager cannot mark paid', 403, 'PATCH', `/api/v1/orders/${order.id}`, { token: mgr.accessToken, body: { status: 'paid' } });
  await expectStatus('admin marks it paid', 200, 'PATCH', `/api/v1/orders/${order.id}`, { token: admin.accessToken, body: { status: 'paid', note: 'Bank transfer' } });
  await expectStatus('a paid order cannot be cancelled', 409, 'PATCH', `/api/v1/orders/${order.id}`, { token: demo.accessToken, body: { status: 'cancelled' } });
  await expectStatus('the manager ships it', 200, 'PATCH', `/api/v1/orders/${order.id}`, { token: mgr.accessToken, body: { status: 'shipped' } });
  const done = await expectStatus('...and completes it', 200, 'PATCH', `/api/v1/orders/${order.id}`, { token: mgr.accessToken, body: { status: 'completed' } });
  check('history: pending, paid, shipped, completed', done.body?.statusHistory?.map((h) => h.status).join(',') === 'pending_payment,paid,shipped,completed');
  const all = await expectStatus('staff see all orders', 200, 'GET', '/api/v1/orders?status=completed', { token: mgr.accessToken });
  check('one completed order', all.body?.total === 1);

  section('CRM: customers');
  const customers = await expectStatus('customers with stats', 200, 'GET', '/api/v1/customers?sort=spent', { token: mgr.accessToken });
  const top = customers.body?.items?.[0];
  check('demo customer on top: 3 orders, $33.99 spent', top?.email === DEMO.email && top?.stats?.orders === 3 && top?.stats?.spentCents === 3399);
  const card = await expectStatus("a customer's card", 200, 'GET', `/api/v1/customers/${demo.user.id}`, { token: mgr.accessToken });
  check('card has recent orders and addresses', card.body?.recentOrders?.length === 3 && card.body?.addresses?.length === 2);
  await expectStatus('a customer cannot open the CRM', 403, 'GET', '/api/v1/customers', { token: demo.accessToken });

  section('Products and shipping (staff)');
  const added = (await expectStatus('add a product', 201, 'POST', '/api/v1/products', { token: mgr.accessToken, body: { name: 'Smoke Roast', category: 'coffee', priceCents: 999, stock: 3 } })).body;
  check('slug made from the name', added?.slug === 'smoke-roast');
  await expectStatus('change it by slug', 200, 'PATCH', '/api/v1/products/smoke-roast', { token: mgr.accessToken, body: { priceCents: 1099 } });
  await expectStatus('a price in fractions of a cent', 400, 'PATCH', '/api/v1/products/smoke-roast', { token: mgr.accessToken, body: { priceCents: 10.5 } });
  await expectStatus('take it off sale', 204, 'DELETE', `/api/v1/products/${added.id}`, { token: mgr.accessToken });
  await expectStatus('...gone for guests', 404, 'GET', '/api/v1/products/smoke-roast');
  await expectStatus('...still there for staff', 200, 'GET', '/api/v1/products/smoke-roast', { token: mgr.accessToken });
  await expectStatus('a customer cannot add products', 403, 'POST', '/api/v1/products', { token: demo.accessToken, body: { name: 'x', category: 'tea', priceCents: 1 } });
  const pigeon = (await expectStatus('add a shipping method', 201, 'POST', '/api/v1/shipping-methods', { token: mgr.accessToken, body: { name: 'Pigeon', priceCents: 100, countries: ['ua'] } })).body;
  await expectStatus('change it', 200, 'PATCH', `/api/v1/shipping-methods/${pigeon.id}`, { token: mgr.accessToken, body: { freeOverCents: 1000 } });
  await expectStatus('stop offering it', 204, 'DELETE', `/api/v1/shipping-methods/${pigeon.id}`, { token: mgr.accessToken });

  section('Users (admin)');
  await expectStatus('a manager cannot list users', 403, 'GET', '/api/v1/users', { token: mgr.accessToken });
  const users = await expectStatus('admin lists users', 200, 'GET', '/api/v1/users?role=customer', { token: admin.accessToken });
  check('two customers', users.body?.total === 2);
  await expectStatus('admin reads one user', 200, 'GET', `/api/v1/users/${manager.id}`, { token: admin.accessToken });
  await expectStatus('admin renames the manager', 200, 'PATCH', `/api/v1/users/${manager.id}`, { token: admin.accessToken, body: { name: 'Renamed Manager' } });
  await expectStatus('admin cannot change own role', 403, 'PATCH', `/api/v1/users/${admin.user.id}`, { token: admin.accessToken, body: { role: 'manager' } });
  await expectStatus('admin cannot delete themselves', 403, 'DELETE', `/api/v1/users/${admin.user.id}`, { token: admin.accessToken });

  // ---------- Protection ----------
  section('Protection');
  const victim = { email: newbie.email.toLowerCase(), password: newbie.password };
  for (let i = 0; i < 5; i++) await call('POST', '/api/v1/auth/sessions', { body: { email: victim.email, password: 'wrong guess' } });
  const locked = await expectStatus('5 wrong passwords lock password login, even the right one', 429, 'POST', '/api/v1/auth/sessions', { body: victim });
  check('the lock says how long, in Retry-After (about 15 minutes)', Number(locked.headers.get('retry-after')) > 14 * 60);
  await expectStatus('...but a code from email still works', 201, 'POST', '/api/v1/auth/otp', { body: { email: victim.email } });
  await expectStatus('...and logs in', 201, 'POST', '/api/v1/auth/sessions', { body: { email: victim.email, code: codeFor(victim.email) } });
  await expectStatus('...which lifts the lock', 201, 'POST', '/api/v1/auth/sessions', { body: victim });

  // ---------- Leaving ----------
  section('Logout and deletion');
  await expectStatus('log out', 204, 'DELETE', '/api/v1/auth/sessions', { body: { refreshToken: mgr.refreshToken } });
  await expectStatus('the logged-out refresh token is dead', 401, 'POST', '/api/v1/auth/sessions', { body: { refreshToken: mgr.refreshToken } });
  await expectStatus('delete the manager (no orders: gone completely)', 204, 'DELETE', `/api/v1/users/${manager.id}`, { token: admin.accessToken });
  await expectStatus('...really gone', 404, 'GET', `/api/v1/users/${manager.id}`, { token: admin.accessToken });
  await expectStatus('delete the demo customer (has orders: data wiped)', 204, 'DELETE', `/api/v1/users/${demo.user.id}`, { token: admin.accessToken });
  const wiped = await expectStatus('...the record stays for the orders', 200, 'GET', `/api/v1/users/${demo.user.id}`, { token: admin.accessToken });
  check('name and email wiped', wiped.body?.name === 'Deleted user' && wiped.body?.email?.endsWith('@deleted.invalid'));
  await expectStatus('...the old token stops working', 401, 'GET', '/api/v1/users/me', { token: demo.accessToken });
  await expectStatus('...the order is still there', 200, 'GET', `/api/v1/orders/${order.id}`, { token: admin.accessToken });

  // ---------- Rate limit ----------
  section('Rate limit per IP');
  let limited;
  for (let i = 0; i < 50 && !limited; i++) {
    const res = await call('POST', '/api/v1/auth/sessions', { body: { email: `nobody${i}@example.com`, password: 'x' } }); // a new email each time: the per-email lock must not kick in first
    if (res.status === 429) limited = res;
  }
  check('too many logins from one IP get 429 with Retry-After', !!limited && Number(limited.headers.get('retry-after')) > 0);
} catch (err) {
  failed++;
  console.log('\n  ✘ the run stopped: ' + err.message);
} finally {
  server?.kill();
  try {
    await dropThrowaway(throwaway);
    console.log(`\nThe throwaway database "${SMOKE_DB}" was dropped.`);
  } catch (err) {
    console.log(`\nCould not drop "${SMOKE_DB}": ${err.message}`);
  }
  const errors = serverLog.split('\n').filter((l) => /Unhandled error|Error:/.test(l));
  if (errors.length) console.log('\nServer errors in the log:\n' + errors.slice(0, 10).join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
