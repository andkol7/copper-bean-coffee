import { addresses } from './modules/addresses/controller.js';
import { addressCreate, addressUpdate } from './modules/addresses/schemas.js';
import { orders } from './modules/orders/controller.js';
import { orderCreate, orderListQuery, orderStatusChange } from './modules/orders/schemas.js';
import { otp } from './modules/otp/controller.js';
import { otpRequest } from './modules/otp/schemas.js';
import { products } from './modules/products/controller.js';
import { productCreate, productListQuery, productUpdate } from './modules/products/schemas.js';
import { sessions } from './modules/sessions/controller.js';
import { sessionCreate, sessionDelete } from './modules/sessions/schemas.js';
import { shippingMethods } from './modules/shipping/controller.js';
import { shippingCreate, shippingListQuery, shippingUpdate } from './modules/shipping/schemas.js';
import { me, users } from './modules/users/controller.js';
import { meUpdate, staffCreate, userListQuery, userRegister, userUpdate } from './modules/users/schemas.js';

// Every route of the app in one list. router.js turns each entry into an Express route.
//
// An entry: { method, path, rateLimit?, auth?, validate?, handler }
//   method    - 'get' | 'post' | 'patch' | 'delete'
//   path      - full URL path, e.g. '/api/v1/products/:slug'
//   rateLimit - per-IP request limit by name from settings.rateLimits ('login', 'otp', 'register', 'order')
//   auth      - who may call it: 'user' (anyone logged in), 'staff' (manager, admin), 'admin',
//               or 'optional' (a guest or anyone logged in; req.user is set only if a token came);
//               no auth = public. The caller (a User) is then in req.user.
//   validate  - optional zod schemas { params?, query?, body? }; the request is checked before
//               the handler runs and the checked data is in req.valid. Required for writes.
//   handler   - async controller function (req, res); small ones like /health live right here
//
// One route per line, so the whole API reads as a table. Order matters where paths overlap:
// /users/me must come before /users/:id.

// Used by Render health checks. The database is connected by server.js before the app starts
// listening, so answering at all means the app is up.
const health = async (req, res) => res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });

export const routes = [
  { method: 'get', path: '/health', handler: health },

  // ---------- Auth ----------
  { method: 'post', path: '/api/v1/auth/otp', rateLimit: 'otp', validate: { body: otpRequest }, handler: otp.create },
  { method: 'post', path: '/api/v1/auth/sessions', rateLimit: 'login', validate: { body: sessionCreate }, handler: sessions.create },
  { method: 'delete', path: '/api/v1/auth/sessions', validate: { body: sessionDelete }, handler: sessions.remove },

  // ---------- Users ----------
  { method: 'post', path: '/api/v1/users', rateLimit: 'register', validate: { body: userRegister }, handler: users.create },
  { method: 'get', path: '/api/v1/users/me', auth: 'user', handler: me.get },
  { method: 'patch', path: '/api/v1/users/me', auth: 'user', validate: { body: meUpdate }, handler: me.update },
  { method: 'get', path: '/api/v1/users', auth: 'admin', validate: { query: userListQuery }, handler: users.list },
  { method: 'get', path: '/api/v1/users/:id', auth: 'admin', handler: users.get },
  { method: 'patch', path: '/api/v1/users/:id', auth: 'admin', validate: { body: userUpdate }, handler: users.update },
  { method: 'delete', path: '/api/v1/users/:id', auth: 'admin', handler: users.remove },
  { method: 'post', path: '/api/v1/staff', auth: 'admin', validate: { body: staffCreate }, handler: users.create },

  // ---------- Products ----------
  { method: 'get', path: '/api/v1/products', auth: 'optional', validate: { query: productListQuery }, handler: products.list },
  { method: 'get', path: '/api/v1/products/:slug', auth: 'optional', handler: products.get },
  { method: 'post', path: '/api/v1/products', auth: 'staff', validate: { body: productCreate }, handler: products.create },
  { method: 'patch', path: '/api/v1/products/:id', auth: 'staff', validate: { body: productUpdate }, handler: products.update },
  { method: 'delete', path: '/api/v1/products/:id', auth: 'staff', handler: products.remove },

  // ---------- Addresses (each user's own) ----------
  { method: 'get', path: '/api/v1/addresses', auth: 'user', handler: addresses.list },
  { method: 'post', path: '/api/v1/addresses', auth: 'user', validate: { body: addressCreate }, handler: addresses.create },
  { method: 'get', path: '/api/v1/addresses/:id', auth: 'user', handler: addresses.get },
  { method: 'patch', path: '/api/v1/addresses/:id', auth: 'user', validate: { body: addressUpdate }, handler: addresses.update },
  { method: 'delete', path: '/api/v1/addresses/:id', auth: 'user', handler: addresses.remove },

  // ---------- Shipping methods ----------
  { method: 'get', path: '/api/v1/shipping-methods', auth: 'optional', validate: { query: shippingListQuery }, handler: shippingMethods.list },
  { method: 'post', path: '/api/v1/shipping-methods', auth: 'staff', validate: { body: shippingCreate }, handler: shippingMethods.create },
  { method: 'patch', path: '/api/v1/shipping-methods/:id', auth: 'staff', validate: { body: shippingUpdate }, handler: shippingMethods.update },
  { method: 'delete', path: '/api/v1/shipping-methods/:id', auth: 'staff', handler: shippingMethods.remove },

  // ---------- Orders (customers: their own; staff: all) ----------
  { method: 'post', path: '/api/v1/orders', rateLimit: 'order', auth: 'user', validate: { body: orderCreate }, handler: orders.create },
  { method: 'get', path: '/api/v1/orders', auth: 'user', validate: { query: orderListQuery }, handler: orders.list },
  { method: 'get', path: '/api/v1/orders/:id', auth: 'user', handler: orders.get },
  { method: 'patch', path: '/api/v1/orders/:id', auth: 'user', validate: { body: orderStatusChange }, handler: orders.update },
];
