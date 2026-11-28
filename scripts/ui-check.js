// npm run check:ui: clicks through the website in a real browser (Edge or Chrome, headless, driven by
// Puppeteer), the way a visitor would: shop, login, address, cart, order, cancel, staff actions, email
// code, registration, token renewal, and two safety checks. Like npm run smoke it uses the database
// server from .env on a THROWAWAY database (<name>-ui-check), seeded first and dropped at the end.
// The browser is found in the usual places; set BROWSER_PATH to use another one.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { dropThrowaway, throwawayUri } from './lib/throwaway-db.js';

const PROJECT = fileURLToPath(new URL('..', import.meta.url));
const throwaway = throwawayUri(process.env.MONGODB_URI, 'ui-check');
const { uri: URI, name: DB } = throwaway;
const PORT = 3996;
const BASE = `http://localhost:${PORT}`;
const ADMIN = { email: 'ui-admin@copperbean.test', password: 'ui admin password 1' };
const DEMO = { email: 'demo@copperbean.test', password: 'demo-password-123' };
const BROWSER = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((path) => path && existsSync(path));
if (!BROWSER) {
  console.error('No Edge or Chrome found. Set BROWSER_PATH to a Chromium-based browser.');
  process.exit(1);
}

const env = { ...process.env, MONGODB_URI: URI, NODE_ENV: 'development', PORT: String(PORT), RUN_JOBS: 'false',
  // Never send real email from a check: the addresses are made up, and the check reads the login
  // codes from the server's terminal. An empty key means "not set" (config.js).
  RESEND_API_KEY: '',
  MAIL_FROM: '', SEED_ADMIN_EMAIL: ADMIN.email, SEED_ADMIN_PASSWORD: ADMIN.password, JWT_SECRET: 'ui-check-secret-'.padEnd(40, 'x') };

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${extra ? `  (${extra})` : ''}`);
};
const section = (name) => console.log(`\n${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const node = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: PROJECT, env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });

let server;
let serverLog = '';
let browser;
const browserErrors = [];

const codeFor = (email) => serverLog.split('----- email -----').filter((b) => b.includes(`To: ${email}`)).at(-1)?.match(/login code is (\d{6})/)?.[1];

try {
  console.log(`Throwaway database: ${DB}`);
  await dropThrowaway(throwaway); // start clean, if a previous run was interrupted
  console.log((await node(['scripts/seed.js'])).trim());

  server = spawn(process.execPath, ['src/server.js'], { cwd: PROJECT, env });
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 60 && !serverLog.includes('Server listening'); i++) await sleep(500);

  browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  page.on('pageerror', (err) => browserErrors.push(`page error: ${err.message}`));
  // Two refusals are made on purpose and the browser logs them: a wrong password (401) and an email
  // template with a typo in a placeholder (400). Anything else in the console is a real problem.
  page.on('console', (msg) => msg.type() === 'error' && !/status of 40[01]/.test(msg.text()) && browserErrors.push(`console: ${msg.text()}`));
  page.on('dialog', (dialog) => dialog.accept()); // "Cancel this order?" -> OK

  const text = () => page.$eval('main', (m) => m.innerText);
  const header = () => page.$eval('#site-header', (m) => m.innerText);
  const go = async (path) => {
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  };
  const waitText = (needle, timeout = 8000) => page.waitForFunction((n) => document.querySelector('main').innerText.includes(n), { timeout }, needle);
  const fill = async (selector, value) => {
    await page.click(selector, { clickCount: 3 });
    await page.type(selector, value);
  };
  const submitAndNavigate = async (selector) => Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click(selector)]);

  // ---------- Shop ----------
  section('Shop');
  await go('/');
  check('the shop lists 12 products', (await text()).includes('12 products'));
  await fill('input[name=q]', 'colombia');
  await page.click('form.filters button[type=submit]');
  await waitText('3 products');
  check('search works and goes into the URL', page.url().includes('q=colombia'));
  await page.select('select[name=category]', 'tea');
  await waitText('Nothing found');
  check('search + category: no tea called colombia', (await text()).includes('Nothing found'));
  await go('/?category=equipment&sort=price_asc');
  const firstCard = await page.$eval('.card h3', (e) => e.textContent);
  check('a filtered URL opens filtered: cheapest equipment first', firstCard === 'Ceramic Pour-Over Dripper', firstCard);
  await page.click('.card');
  await page.waitForSelector('.price');
  check('a card opens its product page', page.url().includes('/product?slug=ceramic-pour-over-dripper'));

  // ---------- Login ----------
  section('Login and register');
  await go('/account');
  check('the account page sends a guest to log in', page.url().includes('/login?next=%2Faccount'));
  await fill('input[name=email]', DEMO.email);
  await fill('input[name=password]', 'wrong password');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.alert.error');
  check('a wrong password shows the error', (await text()).includes('Wrong email, password or code'));
  await fill('input[name=password]', DEMO.password);
  await submitAndNavigate('form button[type=submit]');
  check('logging in goes back to the account', page.url().endsWith('/account'));
  await waitText('Hello, Demo Customer');
  check('the header shows the name and a log out button', (await header()).includes('Demo Customer') && (await header()).includes('Log out'));

  // ---------- Address ----------
  section('Address');
  await page.type('form.grid-form input[name=label]', 'Home');
  // the recipient's name comes from the profile already
  check('the recipient name starts from the profile', (await page.$eval('form.grid-form input[name=name]', (e) => e.value)) === 'Demo Customer');
  await page.type('form.grid-form input[name=phone]', '+380 67 123 45 67');
  await page.type('form.grid-form input[name=line1]', '1 Khreshchatyk St');
  await page.type('form.grid-form input[name=city]', 'Kyiv');
  await page.type('form.grid-form input[name=postalCode]', '01001');
  await page.type('form.grid-form input[name=country]', 'ua');
  await page.click('form.grid-form button[type=submit]');
  await waitText('01001 Kyiv, UA');
  check('a saved address shows up, country as UA', true);

  // ---------- Cart and order ----------
  section('Cart and order');
  await go('/product?slug=ethiopia-yirgacheffe');
  await fill('input[name=quantity]', '2');
  await page.click('form.buy button[type=submit]');
  await waitText('Added to your cart');
  check('the header cart count is 2', (await header()).includes('Cart (2)'));
  await go('/product?slug=hand-burr-grinder');
  await page.click('form.buy button[type=submit]');
  await go('/cart');
  await page.waitForSelector('select[name=shippingMethodId] option');
  let cartText = await text();
  check('the cart shows both lines and the items total $88.00', cartText.includes('Ethiopia Yirgacheffe') && cartText.includes('Hand Burr Grinder') && cartText.includes('$88.00'));
  check('delivery is free over $50 (Standard)', cartText.includes('Delivery: free') && cartText.includes('Total: $88.00'));
  await page.$eval('.qty', (input) => {
    input.value = '0';
    input.dispatchEvent(new Event('change'));
  });
  // Wait for the cart to be drawn again without that line ($59.00 was on the page already, so it is no signal).
  await page.waitForFunction(() => !document.querySelector('main').innerText.includes('Ethiopia Yirgacheffe'), { timeout: 8000 }).catch(() => {});
  cartText = await text();
  check('setting a quantity to 0 removes the line', !cartText.includes('Ethiopia Yirgacheffe'));
  await go('/product?slug=earl-grey');
  await page.click('form.buy button[type=submit]');
  await go('/cart');
  await page.waitForSelector('select[name=shippingMethodId] option');
  await page.type('textarea[name=note]', 'Leave it at the door');
  await submitAndNavigate('form.panel button[type=submit]');
  check('placing the order opens it', page.url().includes('/order?id=') && page.url().includes('placed=1'));
  await waitText('CB-1001');
  const orderText = await text();
  check('the order: CB-1001, waiting for payment, total $68.00, note', orderText.includes('Waiting for payment') && orderText.includes('$68.00') && orderText.includes('Leave it at the door'));
  check('the cart is empty afterwards', (await header()).includes('Cart (0)'));
  check('the customer sees only "Cancel"', (await text()).includes('Cancel the order') && !(await text()).includes('Mark as paid'));
  const orderUrl = page.url().replace('&placed=1', '');

  // a second order, to cancel
  await go('/product?slug=earl-grey');
  await page.click('form.buy button[type=submit]');
  await go('/cart');
  await page.waitForSelector('select[name=shippingMethodId] option');
  await submitAndNavigate('form.panel button[type=submit]');
  await waitText('CB-1002');
  await page.click('.button-row button.danger');
  await waitText('Cancelled');
  check('the customer cancels an unpaid order', (await text()).includes('Cancelled') && !(await text()).includes('Cancel the order'));

  await go('/account');
  await waitText('CB-1002');
  check('the account lists both orders', (await text()).includes('CB-1001') && (await text()).includes('CB-1002'));

  // ---------- Staff ----------
  section('Staff');
  await page.click('#site-header button.link'); // Log out
  await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
  check('logging out shows "Log in" again', (await header()).includes('Log in'));
  await go('/login?next=' + encodeURIComponent(orderUrl.replace(BASE, '')));
  await fill('input[name=email]', ADMIN.email);
  await fill('input[name=password]', ADMIN.password);
  await submitAndNavigate('form button[type=submit]');
  await waitText('CB-1001');
  check('after login the admin lands on the order from ?next', page.url() === orderUrl);
  check('the admin sees "Mark as paid" and "Cancel"', (await text()).includes('Mark as paid') && (await text()).includes('Cancel the order'));
  await page.type('input[name=note]', 'Bank transfer');
  await page.click('.button-row button:not(.danger)');
  await waitText('Mark as shipped');
  await page.click('.button-row button');
  await waitText('Mark as completed');
  await page.click('.button-row button');
  await waitText('Completed');
  const history = await page.$eval('.history', (e) => e.innerText);
  check('paid -> shipped -> completed, with the note in the history', history.includes('Paid') && history.includes('Bank transfer') && history.includes('Completed') && !(await text()).includes('Mark as'));
  // ---------- Staff pages ----------
  section('Staff pages');
  const adminHeader = await header();
  check('the admin header has Orders, Customers and Emails', ['Orders', 'Customers', 'Emails'].every((link) => adminHeader.includes(link)));
  await go('/account');
  await waitText('Work pages');
  check('the account points staff to their work pages', (await text()).includes('Work pages'));

  await go('/staff/orders');
  await waitText('2 orders');
  check('Orders lists every order', (await text()).includes('CB-1001') && (await text()).includes('CB-1002'));
  await page.select('select[name=status]', 'cancelled');
  await waitText('1 order');
  check('the status filter keeps the cancelled one and goes into the URL', (await text()).includes('CB-1002') && !(await text()).includes('CB-1001') && page.url().includes('status=cancelled'));
  await go('/staff/orders?number=cb-1001');
  await waitText('1 order');
  check('search by number (any letter case)', (await text()).includes('CB-1001'));

  await go('/staff/customers?sort=spent');
  await waitText('customer');
  const customersText = await text();
  check('Customers shows the demo customer with 2 orders and $68.00 spent', customersText.includes('Demo Customer') && customersText.includes('$68.00'));
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('table a')]);
  await waitText('Recent orders');
  const card = await text();
  check("a customer's card: stats, contact, addresses, recent orders", card.includes('Spent') && card.includes('demo@copperbean.test') && card.includes('Kyiv') && card.includes('CB-1001'));

  await go('/staff/emails');
  await waitText('order.paid');
  const templateList = await page.$eval('.template-list', (e) => e.innerText);
  check('Emails lists the shop templates', ['otp.code', 'order.created', 'order.paid', 'order.shipped', 'order.cancelled'].every((key) => templateList.includes(key)));
  await page.evaluate(() => [...document.querySelectorAll('.template-link')].find((a) => a.textContent.includes('order.paid')).click());
  await page.waitForSelector('textarea[name=text]');
  check('the preview shows example values', (await page.$eval('.preview', (e) => e.innerText)).includes('CB-1042'));
  await page.$eval('input[name=subject]', (e) => {
    e.value = 'Paid: {number} ({totl})';
    e.dispatchEvent(new Event('input'));
  });
  await page.click('form.panel button[type=submit]');
  await page.waitForSelector('.alert.error');
  check('a typo in a placeholder is refused with the allowed list', (await text()).includes('{totl}') && (await text()).includes('{total}'));
  await page.$eval('input[name=subject]', (e) => {
    e.value = 'Thanks! Order {number} is paid';
    e.dispatchEvent(new Event('input'));
  });
  await page.click('form.panel button[type=submit]');
  await waitText('Saved.');
  check('a fixed subject saves', true);

  await page.click('.template-list button.link'); // + New template
  await page.type('input[name=key]', 'newsletter.welcome');
  await page.type('input[name=subject]', 'Welcome, {name}');
  await page.type('textarea[name=text]', 'Hello {name}!');
  await page.click('form.panel button[type=submit]');
  await waitText('nothing in the shop sends it yet');
  check('a custom template is created and opened', page.url().includes('key=newsletter.welcome'));
  await page.click('.button-row button.danger');
  await waitText('Deleted.');
  check('a custom template can be deleted', !(await page.$eval('.template-list', (e) => e.innerText)).includes('newsletter.welcome'));

  // ---------- Email code and register ----------
  section('Email code and registration');
  await page.click('#site-header button.link');
  await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
  await go('/login');
  await page.click('button[data-tab=code]');
  await fill('input[name=email]', DEMO.email);
  await page.click('form button[type=submit]');
  await waitText('If this email is registered');
  const code = codeFor(DEMO.email);
  check('a code was "emailed" (printed by the dev mailer)', !!code);
  await page.type('input[name=code]', code);
  await submitAndNavigate('form .stack button[type=submit]');
  await waitText('Hello, Demo Customer');
  check('logging in with the code works', true);
  check('a customer has no staff links', !(await header()).includes('Customers'));
  await go('/staff/orders');
  await waitText('Not for you');
  check('a customer opening a staff page is told it is not for them', true);

  await page.click('#site-header button.link');
  await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
  await go('/login');
  await page.click('button[data-tab=register]');
  await page.type('input[name=name]', 'New Visitor');
  await page.type('input[name=email]', 'visitor@example.com');
  await page.type('input[name=password]', 'visitor password');
  await submitAndNavigate('form button[type=submit]');
  await waitText('Hello, New Visitor');
  check('registering logs the new customer straight in', (await text()).includes('No orders yet'));

  // ---------- Token refresh ----------
  section('Session');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('cb.session'));
    s.accessToken = 'expired-or-broken';
    localStorage.setItem('cb.session', JSON.stringify(s));
  });
  await go('/account');
  await waitText('Hello, New Visitor');
  check('a dead access token is renewed with the refresh token, unnoticed', true);
  await page.evaluate(() => localStorage.setItem('cb.session', JSON.stringify({ accessToken: 'x', refreshToken: 'y'.repeat(43), user: { name: 'Ghost' } })));
  await go('/account');
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 8000 }).catch(() => {});
  check('a session that cannot be renewed sends the user to log in', page.url().includes('/login'));

  // ---------- XSS ----------
  section('Safety');
  await page.evaluate(() => localStorage.removeItem('cb.session'));
  await go('/login?next=//evil.example');
  await page.click('button[data-tab=register]');
  await page.type('input[name=name]', '<img src=x onerror=alert(1)>');
  await page.type('input[name=email]', 'xss@example.com');
  await page.type('input[name=password]', 'xss password 1');
  await submitAndNavigate('form button[type=submit]');
  check('?next=//evil.example is ignored: stays on this site', page.url().startsWith(BASE + '/account'));
  await waitText('Hello, <img');
  check('a name with HTML in it is shown as text, not run', (await page.$('main img')) === null);
} catch (err) {
  failed++;
  console.log(`\n  ✘ the run stopped: ${err.message.split('\n')[0]}`);
} finally {
  await browser?.close();
  server?.kill();
  try {
    await dropThrowaway(throwaway);
    console.log(`\nThe throwaway database "${DB}" was dropped.`);
  } catch (err) {
    console.log(`Could not drop ${DB}: ${err.message}`);
  }
  if (browserErrors.length) console.log('\nErrors in the browser:\n  ' + [...new Set(browserErrors)].join('\n  '));
  const serverErrors = serverLog.split('\n').filter((l) => /Unhandled error|Error:/.test(l));
  if (serverErrors.length) console.log('\nErrors in the server log:\n  ' + serverErrors.slice(0, 10).join('\n  '));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
