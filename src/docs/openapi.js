import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { routes as appRoutes } from '../routes.js';

// The OpenAPI description of the API, shown by Swagger UI at /docs and given as JSON at
// /docs/openapi.json. It is BUILT from routes.js, not written by hand:
//   method, path        -> the operation
//   auth                -> the lock icon (Bearer token) and the 401/403 answers
//   rateLimit           -> the 429 answer
//   validate (zod)      -> path parameters, query parameters and the request body, as JSON Schema
// So a new route shows up here by itself, with the fields it really accepts, and the docs cannot
// drift from the code. Only the one-line summaries below are written by hand; a test makes sure
// every route has one.

// One line per route, keyed by "METHOD path" exactly as in routes.js.
export const SUMMARIES = {
  'GET /health': 'Is the server up',

  'POST /api/v1/auth/otp': 'Email a one-time login code (the same answer for unknown emails)',
  'POST /api/v1/auth/sessions': 'Log in with a password or an email code, or swap a refresh token for a new pair',
  'DELETE /api/v1/auth/sessions': 'Log out: ends the login the refresh token belongs to',

  'POST /api/v1/users': 'Register (always as a customer)',
  'GET /api/v1/users/me': 'My profile',
  'PATCH /api/v1/users/me': 'Change my name, phone or password (a new password needs the current one)',
  'GET /api/v1/users': 'All users (admin)',
  'GET /api/v1/users/:id': 'One user (admin)',
  'PATCH /api/v1/users/:id': "Change a user's name, phone or role (admin)",
  'DELETE /api/v1/users/:id': 'Delete a user; with orders only the personal data is wiped (admin)',
  'POST /api/v1/staff': 'Create a manager or an admin (admin)',

  'GET /api/v1/products': 'Products on sale: filters, full-text search, sorting, pages',
  'GET /api/v1/products/:idOrSlug': 'One product, by id or slug',
  'POST /api/v1/products': 'Add a product (staff)',
  'PATCH /api/v1/products/:idOrSlug': 'Change a product (staff)',
  'DELETE /api/v1/products/:idOrSlug': 'Take a product off sale; PATCH active: true brings it back (staff)',

  'GET /api/v1/addresses': 'My saved addresses',
  'POST /api/v1/addresses': 'Save an address',
  'GET /api/v1/addresses/:id': 'One of my addresses',
  'PATCH /api/v1/addresses/:id': 'Change one of my addresses',
  'DELETE /api/v1/addresses/:id': 'Delete one of my addresses',

  'GET /api/v1/shipping-methods': 'Shipping methods on offer, cheapest first (?country=UA)',
  'POST /api/v1/shipping-methods': 'Add a shipping method (staff)',
  'PATCH /api/v1/shipping-methods/:id': 'Change a shipping method (staff)',
  'DELETE /api/v1/shipping-methods/:id': 'Stop offering a shipping method (staff)',

  'POST /api/v1/orders': 'Place an order: prices come from the database, stock is reserved',
  'GET /api/v1/orders': 'Orders: customers see their own, staff see all',
  'GET /api/v1/orders/:id': 'One order',
  'PATCH /api/v1/orders/:id': 'Change the status: customers cancel unpaid orders, staff move them along',

  'GET /api/v1/customers': 'Customers with order stats (staff)',
  'GET /api/v1/customers/:id': "A customer's card: stats, recent orders, addresses (staff)",

  'GET /api/v1/email-templates': 'All email templates, with the variables each may use (admin)',
  'POST /api/v1/email-templates': 'Add an email template of your own (admin)',
  'GET /api/v1/email-templates/:key': 'One email template, e.g. order.paid (admin)',
  'PATCH /api/v1/email-templates/:key': "Change a template's subject, text or switch it off (admin)",
  'DELETE /api/v1/email-templates/:key': "Delete a template of your own; the shop's own cannot be deleted (admin)",

  'GET /api/v1/request-logs': 'The request log: every API request with status, time and errors (admin)',
};

const DESCRIPTION = `A demo coffee shop API: products, shipping, addresses, orders with stock reservation and a
status machine, a small CRM, and email OTP and password login with rotating refresh tokens.

**To try the closed routes:** log in with \`POST /api/v1/auth/sessions\`, copy \`accessToken\`
from the answer, press **Authorize** above and paste it. The access token lives 15 minutes; the
refresh token in the same answer gets a new pair.

**Money** is always in cents as whole numbers: \`1450\` means $14.50.

**Errors** always look like \`{ "error": { "code": "...", "message": "...", "details": [...] } }\`.`;

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

// zod schema -> JSON Schema. `input`: what a client sends (before transforms such as "ua" -> "UA").
// Checks that JSON Schema cannot express (a refine like "min price <= max price") are left out;
// the server still applies them.
const toJsonSchema = (schema) => {
  const { $schema, ...json } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  return json;
};

// /api/v1/users/:id -> /api/v1/users/{id}
const openApiPath = (path) => path.replace(/:(\w+)/g, '{$1}');

// The group in Swagger UI: /api/v1/shipping-methods/... -> "shipping-methods"; /health -> "system".
const tagOf = (path) => path.match(/^\/api\/v1\/([^/]+)/)?.[1] ?? 'system';

const errorRef = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

function operation(route) {
  const { method, path, auth, rateLimit, validate = {} } = route;
  const op = { tags: [tagOf(path)], summary: SUMMARIES[`${method.toUpperCase()} ${path}`] };

  // Path parameters (always strings in a URL) and query parameters (from validate.query).
  const parameters = [...path.matchAll(/:(\w+)/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  if (validate.query) {
    const { properties = {}, required = [] } = toJsonSchema(validate.query);
    for (const [name, schema] of Object.entries(properties)) {
      parameters.push({ name, in: 'query', required: required.includes(name), schema });
    }
  }
  if (route.handler.name === 'list') {
    // Every list takes the same paging; it is checked inside BaseController.list, not in routes.js.
    for (const name of ['page', 'limit']) {
      if (!parameters.some((p) => p.name === name)) {
        parameters.push({ name, in: 'query', required: false, schema: { type: 'integer', minimum: 1, ...(name === 'limit' ? { maximum: 50 } : {}) } });
      }
    }
  }
  if (parameters.length) op.parameters = parameters;

  if (validate.body) {
    op.requestBody = { required: true, content: { 'application/json': { schema: toJsonSchema(validate.body) } } };
  }

  // Who may call it. 'optional': works without a token, shows more with one (e.g. hidden products).
  if (auth === 'optional') op.security = [{}, { bearerAuth: [] }];
  else if (auth) op.security = [{ bearerAuth: [] }];

  const ok = { post: ['201', 'Created'], delete: ['204', 'Done, no content'] }[method] ?? ['200', 'OK'];
  op.responses = { [ok[0]]: { description: ok[1] } };
  if (validate.body || validate.query || parameters.length) op.responses['400'] = errorRef('The request is not valid; `details` says which field');
  if (auth && auth !== 'optional') op.responses['401'] = errorRef('No token, or it has expired');
  if (auth && auth !== 'user' && auth !== 'optional') op.responses['403'] = errorRef(`Only for ${auth}`);
  if (path.includes(':')) op.responses['404'] = errorRef('Not found (or not yours)');
  if (method === 'post' || method === 'patch') op.responses['409'] = errorRef('Conflicts with the current state, e.g. a taken email or not enough stock');
  if (rateLimit) op.responses['429'] = errorRef('Too many requests; see the Retry-After header');
  return op;
}

export function buildOpenApi(list = appRoutes) {
  const paths = {};
  for (const route of list) {
    (paths[openApiPath(route.path)] ??= {})[route.method] = operation(route);
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Copper Bean Coffee API', version, description: DESCRIPTION },
    servers: [{ url: '/' }],
    tags: [
      { name: 'auth', description: 'Logging in and out' },
      { name: 'users', description: 'Accounts and profiles' },
      { name: 'staff', description: 'Creating managers and admins' },
      { name: 'products', description: 'The shop window' },
      { name: 'shipping-methods', description: 'Delivery options and prices' },
      { name: 'addresses', description: "Each user's saved delivery addresses" },
      { name: 'orders', description: 'Placing and handling orders' },
      { name: 'customers', description: 'The CRM view of customers' },
      { name: 'email-templates', description: 'The texts of the emails the shop sends' },
      { name: 'request-logs', description: 'What happened: every API request, kept two weeks' },
      { name: 'system', description: 'Service checks' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The accessToken from POST /api/v1/auth/sessions' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', examples: ['validation_error'] },
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
              },
              required: ['code', 'message'],
            },
          },
        },
      },
    },
  };
}
